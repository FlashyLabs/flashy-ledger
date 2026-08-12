import type { Entry } from '../domain/entry.js'
import type { ProposedEntry } from '../domain/post.js'
import type { LedgerState } from '../domain/post.js'

/**
 * The seam between the ledger's rules and wherever entries physically live.
 *
 * This interface is the entire migration story. A document database implements
 * it today; a chain-backed store can implement it later; the domain above does
 * not change either way, because the domain never knew where entries were kept.
 *
 * Implementations MUST guarantee:
 *
 *   1. `append` is atomic — the entry and any projection it updates commit
 *      together or not at all.
 *   2. `idempotencyKey` is unique. A second append with the same key returns
 *      the original entry and writes nothing.
 *   3. Entries are immutable once written. There is deliberately no update or
 *      delete on this interface.
 *   4. `readState` reflects every entry appended before it was called, so two
 *      concurrent appends cannot both build on the same head.
 */
export interface LedgerStore {
  /**
   * Persist an entry. Returns what was written, and whether this call is a
   * replay of a key that had already been posted.
   */
  append(entry: ProposedEntry): Promise<AppendResult>

  /** Current balance and chain head for an identity's holding of one asset. */
  readState(identityId: string, assetId: string): Promise<LedgerState>

  /** Full history, oldest first. Used for audit and for rebuilding projections. */
  readEntries(identityId: string, assetId?: string): Promise<readonly Entry[]>

  /** Look up by idempotency key, for callers that want to check before posting. */
  findByIdempotencyKey(key: string): Promise<Entry | null>
}

export interface AppendResult {
  readonly entry: Entry
  /** True when the key already existed and nothing new was written. */
  readonly deduplicated: boolean
}

/**
 * Stores that can commit several entries atomically. A transfer needs this:
 * the sender's debit and the recipient's credit must both land or neither.
 *
 * Separate from LedgerStore because not every backing store can offer it, and a
 * store that cannot should fail to compile rather than fail at runtime.
 */
export interface TransactionalLedgerStore extends LedgerStore {
  appendAll(entries: readonly ProposedEntry[]): Promise<readonly AppendResult[]>
}

export function isTransactional(store: LedgerStore): store is TransactionalLedgerStore {
  return typeof (store as TransactionalLedgerStore).appendAll === 'function'
}
