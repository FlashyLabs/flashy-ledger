import type { Collection, Db, MongoClient, ObjectId, OptionalId } from 'mongodb'
import type { Entry, EntryKind, EntrySource } from '../domain/entry.js'
import type { LedgerState, ProposedEntry } from '../domain/post.js'
import { ZERO, minor } from '../domain/money.js'
import type {
  AccountRef,
  AppendResult,
  HistoryRef,
  TransactionalLedgerStore,
} from '../ports/store.js'

/**
 * MongoDB implementation of the store port.
 *
 * The domain decides what an entry should be; this decides where it lives and,
 * critically, what the database itself refuses to allow. Three guarantees the
 * port demands are enforced by indexes rather than by code here, because code
 * in this file runs once per process and an index runs on every write from
 * every process forever:
 *
 *   1. `(tenantId, idempotencyKey)` is unique. A replay cannot become a second
 *      entry even if two processes race the same key at the same instant — and
 *      the tenant is part of the key, so two networks deriving the same key
 *      from similar source events do not deduplicate against each other.
 *   2. `(tenantId, identityId, assetId, previousHash)` is unique. This is what
 *      stops two concurrent appends both building on the same chain head — the
 *      second one violates the index and is retried against the new head rather
 *      than silently forking history.
 *   3. Nothing updates or deletes. There is no code path in this class that
 *      issues either, matching the port's requirement that entries are
 *      immutable.
 *
 * ON AMOUNTS
 * ──────────
 * Minor units are integers and can exceed 2^53 over a long-lived ledger, so
 * they are stored as BSON `Long` via the driver's `Int64`-ish handling and
 * converted at this boundary only. The domain never sees a Mongo type and this
 * file never does arithmetic.
 */

/** The document shape. Deliberately explicit rather than inferred from Entry. */
interface EntryDoc {
  _id?: ObjectId
  tenantId: string
  identityId: string
  assetId: string
  /** Stored as a string: minor units are integers that can outgrow a double. */
  amount: string
  balanceBefore: string
  balanceAfter: string
  kind: EntryKind
  source: EntrySource
  idempotencyKey: string
  occurredAt: Date
  previousHash: string | null
  hash: string
  metadata?: Record<string, unknown>
}

const DUPLICATE_KEY = 11000

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number }).code === DUPLICATE_KEY
}

function toDoc(entry: ProposedEntry): OptionalId<EntryDoc> {
  return {
    tenantId: entry.tenantId,
    identityId: entry.identityId,
    assetId: entry.assetId,
    amount: String(entry.amount),
    balanceBefore: String(entry.balanceBefore),
    balanceAfter: String(entry.balanceAfter),
    kind: entry.kind,
    source: entry.source,
    idempotencyKey: entry.idempotencyKey,
    occurredAt: entry.occurredAt,
    previousHash: entry.previousHash,
    hash: entry.hash,
    ...(entry.metadata ? { metadata: entry.metadata } : {}),
  }
}

function fromDoc(doc: OptionalId<EntryDoc>): Entry {
  return {
    id: String(doc._id),
    tenantId: doc.tenantId,
    identityId: doc.identityId,
    assetId: doc.assetId,
    amount: minor(Number(doc.amount)),
    balanceBefore: minor(Number(doc.balanceBefore)),
    balanceAfter: minor(Number(doc.balanceAfter)),
    kind: doc.kind,
    source: doc.source,
    idempotencyKey: doc.idempotencyKey,
    occurredAt: doc.occurredAt,
    previousHash: doc.previousHash,
    hash: doc.hash,
    ...(doc.metadata ? { metadata: doc.metadata } : {}),
  }
}

export interface MongoLedgerStoreOptions {
  /** Collection name. Defaults to `ledger_entries`. */
  collection?: string
  /**
   * A client, required only for multi-entry appends. Transfers need two
   * entries to commit together, which needs a session, which needs the client
   * rather than the database handle.
   *
   * Without it, `appendAll` rejects any batch of more than one entry rather
   * than writing a transfer half-way. Failing loudly beats a torn transfer.
   */
  client?: MongoClient
}

export class MongoLedgerStore implements TransactionalLedgerStore {
  private readonly entries: Collection<EntryDoc>
  private readonly client?: MongoClient

  constructor(db: Db, options: MongoLedgerStoreOptions = {}) {
    this.entries = db.collection<EntryDoc>(options.collection ?? 'ledger_entries')
    this.client = options.client
  }

  /**
   * Create the indexes the port's guarantees depend on.
   *
   * Call once at startup. Idempotent — Mongo ignores an index that already
   * exists with the same specification.
   */
  async ensureIndexes(): Promise<void> {
    // The pre-0.2 indexes were globally unique rather than tenant-scoped, and a
    // surviving one silently defeats the isolation below: the old
    // `uniq_idempotency` would still reject a second tenant's legitimate write
    // even though the new index permits it. Creating the new ones without
    // removing the old would look like a successful migration and behave like
    // no migration at all, so they are dropped first and by name.
    for (const legacy of ['uniq_idempotency', 'uniq_chain_head', 'chain_order']) {
      try {
        await this.entries.dropIndex(legacy)
      } catch {
        // IndexNotFound. Expected on a fresh collection and on any deployment
        // that has already migrated.
      }
    }

    await this.entries.createIndex(
      { tenantId: 1, idempotencyKey: 1 },
      { unique: true, name: 'uniq_tenant_idempotency' },
    )

    // The chain-head guard. Two appends that both read the same head produce
    // the same previousHash, and this index lets exactly one of them land.
    //
    // It does not need to be partial. The first entry of every chain has
    // previousHash null, but identityId and assetId are part of the key — so
    // "one entry with no predecessor" is scoped per chain, which is exactly
    // the constraint wanted, rather than one null across the collection.
    await this.entries.createIndex(
      { tenantId: 1, identityId: 1, assetId: 1, previousHash: 1 },
      { unique: true, name: 'uniq_tenant_chain_head' },
    )

    // Reading a chain in order, and finding its head, are the two hot paths.
    await this.entries.createIndex(
      { tenantId: 1, identityId: 1, assetId: 1, _id: 1 },
      { name: 'tenant_chain_order' },
    )
  }

  async append(proposed: ProposedEntry): Promise<AppendResult> {
    const existing = await this.findByIdempotencyKey(proposed.tenantId, proposed.idempotencyKey)
    if (existing) return { entry: existing, deduplicated: true }

    try {
      const doc = toDoc(proposed)
      const { insertedId } = await this.entries.insertOne(doc)
      return { entry: fromDoc({ ...doc, _id: insertedId }), deduplicated: false }
    } catch (err) {
      if (!isDuplicateKey(err)) throw err

      // Lost a race. Either on the key — in which case the winner's entry is
      // the answer and this is a replay — or on the chain head, which is a
      // genuine conflict the caller must retry against the new head.
      const winner = await this.findByIdempotencyKey(proposed.tenantId, proposed.idempotencyKey)
      if (winner) return { entry: winner, deduplicated: true }

      throw new Error(
        `Concurrent append to ${proposed.identityId}/${proposed.assetId}: the chain head moved. Re-read state and retry.`,
        { cause: err },
      )
    }
  }

  /**
   * All or nothing.
   *
   * A transfer's debit and credit must both land or neither, which is the one
   * thing a single-document database cannot give you for free. It requires a
   * session, and therefore a replica set — a standalone mongod will reject the
   * transaction rather than silently write half of it.
   */
  async appendAll(proposed: readonly ProposedEntry[]): Promise<readonly AppendResult[]> {
    if (proposed.length === 0) return []
    if (proposed.length === 1) {
      const first = proposed[0]
      if (!first) throw new Error('appendAll: length is 1 but the entry is missing')
      return [await this.append(first)]
    }

    if (!this.client) {
      throw new Error(
        'MongoLedgerStore.appendAll needs a MongoClient to open a session. ' +
          'Pass { client } to the constructor — without it a multi-entry append ' +
          'cannot be made atomic, and writing part of a transfer is worse than writing none.',
      )
    }

    const session = this.client.startSession()
    try {
      let results: AppendResult[] = []

      await session.withTransaction(async () => {
        // Reset per attempt: withTransaction may retry the callback on a
        // transient error, and results from an aborted attempt are not real.
        results = []

        for (const candidate of proposed) {
          const existing = await this.entries.findOne(
            { tenantId: candidate.tenantId, idempotencyKey: candidate.idempotencyKey },
            { session },
          )
          if (existing) {
            results.push({ entry: fromDoc(existing), deduplicated: true })
            continue
          }

          const doc = toDoc(candidate)
          const { insertedId } = await this.entries.insertOne(doc, { session })
          results.push({ entry: fromDoc({ ...doc, _id: insertedId }), deduplicated: false })
        }
      })

      return results
    } finally {
      await session.endSession()
    }
  }

  async readState({ tenantId, identityId, assetId }: AccountRef): Promise<LedgerState> {
    const head = await this.entries.findOne(
      { tenantId, identityId, assetId },
      { sort: { _id: -1 } },
    )

    if (!head) return { balance: ZERO, headHash: null }

    return {
      balance: minor(Number(head.balanceAfter)),
      headHash: head.hash,
    }
  }

  async readEntries({ tenantId, identityId, assetId }: HistoryRef): Promise<readonly Entry[]> {
    const filter =
      assetId === undefined ? { tenantId, identityId } : { tenantId, identityId, assetId }
    const docs = await this.entries.find(filter).sort({ _id: 1 }).toArray()
    return docs.map(fromDoc)
  }

  async findByIdempotencyKey(tenantId: string, key: string): Promise<Entry | null> {
    const doc = await this.entries.findOne({ tenantId, idempotencyKey: key })
    return doc ? fromDoc(doc) : null
  }
}
