import type { Collection, Db, ObjectId } from 'mongodb'
import type { ChainVerdict, Entry, EntryKind, EntrySource } from '../domain/entry.js'
import { verifyChain } from '../domain/entry.js'
import type { LedgerState } from '../domain/post.js'
import { ZERO, minor, type Minor } from '../domain/money.js'

/**
 * A read-only view of ClaimYour.Gold's existing ledger.
 *
 * WHY THIS EXISTS ALONGSIDE MongoLedgerStore
 * ──────────────────────────────────────────
 * `MongoLedgerStore` writes this package's own format: hash-chained entries in
 * `ledger_entries`, amounts as integer minor units, every entry linked to its
 * predecessor. That format is correct and it is where the estate is going.
 *
 * ClaimYour.Gold's live ledger is not in that format. `gold_ledger` has
 * floating-point amounts, no chain, and a different column set — several years
 * of real money, already written. The two cannot be swapped by changing a
 * connection string.
 *
 * The decision taken was to chain forward: new entries adopt the chained
 * format from a marked cutover, historical rows keep their shape and do not
 * pretend to a tamper-evidence they never had. This adapter is the first half
 * of that — it lets anything built on the `LedgerStore` port read the existing
 * ledger today, without a migration and without a second query language.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * ────────────────────────────────
 * It does not implement `append`, so it is not a `LedgerStore`. That is the
 * point. ClaimYour.Gold's `postEntry` remains the only writer of `gold_ledger`
 * while both formats coexist, and a second writer arriving through a different
 * code path is exactly the hazard the whole extraction is trying to avoid.
 * Making this read-only means a consumer that tries to write fails to compile
 * rather than at runtime, in production, against money.
 *
 * ON `headHash`
 * ─────────────
 * Null for an identity whose newest entry predates the cutover, and the real
 * head hash once one has been chained. Inventing a hash for an unchained row
 * would be worse than admitting there isn't one — it would look like
 * tamper-evidence to every caller while proving nothing at all. Withholding a
 * hash that does exist is the opposite error and just as expensive: a caller
 * that posts from a null head starts a second chain alongside the live one,
 * and the fork stays invisible until someone tries to verify.
 */

/** The shape of a `gold_ledger` document, as ClaimYour.Gold writes it. */
interface GoldLedgerDoc {
  _id: ObjectId
  publicId: string
  tenantId: string
  customerId: string
  assetId: string
  entryType: string
  /** Major units, floating point. Converted at this boundary and nowhere else. */
  amount: number
  balanceBefore: number
  balanceAfter: number
  sourceType: string
  sourceId?: string | null
  idempotencyKey: string
  description?: string | null
  metadata?: Record<string, unknown> | null
  createdAt: Date
  /**
   * Chain fields, written by ClaimYour.Gold's `postEntry` from the cutover
   * onward and absent on everything older. Optional in the type because the
   * collection genuinely holds both shapes — years of unchained rows, then
   * chained ones — and making them required here would be a claim about the
   * data that is not true.
   */
  previousHash?: string | null
  hash?: string | null
}

interface WalletDoc {
  _id: ObjectId
  customerId: string
  goldBalance: number
}

export interface GoldLedgerStoreOptions {
  /** Defaults to `gold_ledger`. */
  entriesCollection?: string
  /** Defaults to `wallets`. */
  walletsCollection?: string
  /**
   * Decimal places for the asset. Flashy Gold is 2. Used only to convert the
   * stored floating-point major units into the integer minor units the domain
   * works in — the domain never sees a float.
   */
  decimals?: number
}

/**
 * Map ClaimYour.Gold's entry types onto the domain's small vocabulary.
 *
 * The stored enum has thirty-odd values covering both money movement and, for
 * historical reasons, some policy and lifecycle states that were never ledger
 * entries at all. The domain only distinguishes what a movement *is*, so the
 * sign decides, and the original value is preserved in `source` rather than
 * being forced into a category that would lose it.
 */
function toKind(amount: number): EntryKind {
  return amount >= 0 ? 'EARN' : 'SPEND'
}

/**
 * Was this entry written after the chain-forward cutover?
 *
 * The distinction is the whole point of chaining forward rather than migrating:
 * both kinds of row are legitimate, and only one of them carries a guarantee.
 * Callers that report on the ledger need to be able to tell them apart without
 * knowing a date.
 */
export function isChained(entry: Entry): boolean {
  return entry.hash !== ''
}

/** What `auditChain` found for one identity's holding. */
export interface ChainAudit {
  /**
   * Verdict over the chained entries alone. Pre-cutover rows are excluded
   * rather than failed: they were never chained, so reporting them as broken
   * would make every real break impossible to see.
   */
  readonly verdict: ChainVerdict
  readonly chainedEntries: number
  readonly unchainedEntries: number
  /** When this identity's chain begins. Null if it has not started. */
  readonly chainedFrom: Date | null
}

export class GoldLedgerReader {
  private readonly entries: Collection<GoldLedgerDoc>
  private readonly wallets: Collection<WalletDoc>
  private readonly scale: number

  constructor(db: Db, options: GoldLedgerStoreOptions = {}) {
    this.entries = db.collection<GoldLedgerDoc>(options.entriesCollection ?? 'gold_ledger')
    this.wallets = db.collection<WalletDoc>(options.walletsCollection ?? 'wallets')
    this.scale = 10 ** (options.decimals ?? 2)
  }

  /**
   * Convert stored major units to the domain's minor units.
   *
   * Rounded, not truncated. The stored column is a float, so a value written as
   * 12.34 can read back as 12.339999999999998, and truncating that loses a
   * whole minor unit — per entry, in the direction of the house.
   */
  private toMinorUnits(major: number): Minor {
    return minor(Math.round(major * this.scale))
  }

  private fromDoc(doc: GoldLedgerDoc): Entry {
    const source: EntrySource = {
      type: doc.sourceType,
      ...(doc.sourceId ? { id: doc.sourceId } : {}),
    }

    return {
      id: String(doc._id),
      tenantId: doc.tenantId,
      identityId: doc.customerId,
      assetId: doc.assetId,
      amount: this.toMinorUnits(doc.amount),
      balanceBefore: this.toMinorUnits(doc.balanceBefore),
      balanceAfter: this.toMinorUnits(doc.balanceAfter),
      kind: toKind(doc.amount),
      source,
      idempotencyKey: doc.idempotencyKey,
      occurredAt: doc.createdAt,
      // Chained rows carry their real links. Pre-cutover rows are unchained,
      // and the empty hash says so — `Entry.hash` is a string, so there is no
      // null to return, and an empty one is the value `isChained` tests for.
      previousHash: doc.previousHash ?? null,
      hash: doc.hash ?? '',
      metadata: {
        // Kept so nothing is lost in translation: the stored entry type is
        // richer than the domain's EARN/SPEND and callers may want it.
        goldLedgerEntryType: doc.entryType,
        publicId: doc.publicId,
        ...(doc.description ? { description: doc.description } : {}),
        ...(doc.metadata ?? {}),
      },
    }
  }

  /**
   * Balance and chain head for one identity's holding.
   *
   * The balance comes from the newest entry's `balanceAfter`, not from
   * `wallets.goldBalance`. Both should agree, and where they do not the ledger
   * is the one to believe — the wallet is a cached fold over entries, and it is
   * the cache that has historically drifted.
   */
  async readState(identityId: string, assetId: string): Promise<LedgerState> {
    const head = await this.entries.findOne(
      { customerId: identityId, assetId },
      { sort: { createdAt: -1, _id: -1 } },
    )

    if (!head) return { balance: ZERO, headHash: null }

    return {
      balance: this.toMinorUnits(head.balanceAfter),
      // Null when the newest entry predates the cutover — that identity's
      // chain has not started, and the next entry posted for it becomes the
      // first link. Exactly the rule ClaimYour.Gold's postEntry applies when
      // it reads its own head, and the two must agree or they fork.
      headHash: head.hash ?? null,
    }
  }

  async readEntries(identityId: string, assetId?: string): Promise<readonly Entry[]> {
    const filter =
      assetId === undefined ? { customerId: identityId } : { customerId: identityId, assetId }

    const docs = await this.entries
      .find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .toArray()

    return docs.map((d) => this.fromDoc(d))
  }

  /**
   * The most recent entries for one identity, newest first.
   *
   * `readEntries` returns everything, which is right for an audit and wrong for
   * an API response — a long-lived hunter has thousands of entries and no
   * endpoint should serialise all of them to answer "what happened lately?".
   */
  async readRecentEntries(
    identityId: string,
    assetId: string,
    limit = 50,
  ): Promise<readonly Entry[]> {
    const docs = await this.entries
      .find({ customerId: identityId, assetId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(Math.min(limit, 200))
      .toArray()

    return docs.map((d) => this.fromDoc(d))
  }

  /**
   * Verify the chained part of one identity's history.
   *
   * Chaining forward buys nothing until something checks the chain, and until
   * this existed nothing could: the reader discarded the hash fields, so every
   * entry came back looking unchained no matter how it was written.
   *
   * Only the chained suffix is verified. A chain-forward ledger holds two
   * populations of row, and running `verifyChain` across both reports every
   * pre-cutover entry as a break — which is not a finding, it is the design,
   * and it would bury the one break that matters. The counts are returned
   * alongside so a caller can say how much of the history is actually covered
   * rather than implying all of it is.
   *
   * A gap in the middle — an unchained row appearing after chained ones — is
   * left to fail the verdict rather than being filtered away. That ordering
   * cannot happen if `postEntry` is the only writer, so if it appears, a
   * second writer exists and that is precisely what needs surfacing.
   */
  async auditChain(identityId: string, assetId: string): Promise<ChainAudit> {
    const all = await this.readEntries(identityId, assetId)
    const firstChained = all.findIndex(isChained)

    if (firstChained === -1) {
      return {
        verdict: { valid: true, problems: [] },
        chainedEntries: 0,
        unchainedEntries: all.length,
        chainedFrom: null,
      }
    }

    const chained = all.slice(firstChained)
    return {
      verdict: verifyChain(chained),
      chainedEntries: chained.length,
      unchainedEntries: firstChained,
      chainedFrom: chained[0]?.occurredAt ?? null,
    }
  }

  async findByIdempotencyKey(key: string): Promise<Entry | null> {
    const doc = await this.entries.findOne({ idempotencyKey: key })
    return doc ? this.fromDoc(doc) : null
  }

  /**
   * Does the cached wallet balance still match the ledger?
   *
   * This is the question that has never been answered against production data.
   * Exposing it here means any consumer can ask it, rather than it living in a
   * script that has to be remembered and run.
   */
  async verifyBalance(
    identityId: string,
    assetId: string,
  ): Promise<{ ok: boolean; wallet: number; ledger: number }> {
    const [walletDoc, state] = await Promise.all([
      this.wallets.findOne({ customerId: identityId }),
      this.readState(identityId, assetId),
    ])

    const wallet = this.toMinorUnits(walletDoc?.goldBalance ?? 0)
    return { ok: wallet === state.balance, wallet, ledger: state.balance }
  }
}
