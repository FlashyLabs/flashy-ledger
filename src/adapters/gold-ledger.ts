import type { Collection, Db, ObjectId } from 'mongodb'
import type { Entry, EntryKind, EntrySource } from '../domain/entry.js'
import type { LedgerState } from '../domain/post.js'
import { ZERO, minor, type Minor } from '../domain/money.js'
import type { AccountRef, HistoryRef } from '../ports/store.js'

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
 * Always null. Pre-cutover rows have no chain, and inventing a hash here would
 * be worse than admitting there isn't one: it would look like tamper-evidence
 * to every caller while proving nothing at all.
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
      // Pre-cutover rows are unchained, and saying so is the honest answer.
      previousHash: null,
      hash: '',
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
  async readState({ tenantId, identityId, assetId }: AccountRef): Promise<LedgerState> {
    const head = await this.entries.findOne(
      { tenantId, customerId: identityId, assetId },
      { sort: { createdAt: -1, _id: -1 } },
    )

    if (!head) return { balance: ZERO, headHash: null }

    return {
      balance: this.toMinorUnits(head.balanceAfter),
      headHash: null,
    }
  }

  async readEntries({ tenantId, identityId, assetId }: HistoryRef): Promise<readonly Entry[]> {
    const filter =
      assetId === undefined
        ? { tenantId, customerId: identityId }
        : { tenantId, customerId: identityId, assetId }

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
    { tenantId, identityId, assetId }: AccountRef,
    limit = 50,
  ): Promise<readonly Entry[]> {
    const docs = await this.entries
      .find({ tenantId, customerId: identityId, assetId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(Math.min(limit, 200))
      .toArray()

    return docs.map((d) => this.fromDoc(d))
  }

  async findByIdempotencyKey(tenantId: string, key: string): Promise<Entry | null> {
    const doc = await this.entries.findOne({ tenantId, idempotencyKey: key })
    return doc ? this.fromDoc(doc) : null
  }

  /**
   * Does the cached wallet balance still match the ledger?
   *
   * This is the question that has never been answered against production data.
   * Exposing it here means any consumer can ask it, rather than it living in a
   * script that has to be remembered and run.
   */
  async verifyBalance(ref: AccountRef): Promise<{ ok: boolean; wallet: number; ledger: number }> {
    const [walletDoc, state] = await Promise.all([
      this.wallets.findOne({ customerId: ref.identityId }),
      this.readState(ref),
    ])

    const wallet = this.toMinorUnits(walletDoc?.goldBalance ?? 0)
    return { ok: wallet === state.balance, wallet, ledger: state.balance }
  }
}
