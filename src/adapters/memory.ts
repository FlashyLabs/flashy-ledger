import type { Entry } from '../domain/entry.js'
import type { LedgerState, ProposedEntry } from '../domain/post.js'
import { ZERO } from '../domain/money.js'
import type { AppendResult, TransactionalLedgerStore } from '../ports/store.js'

/**
 * Reference implementation of the store port, entirely in memory.
 *
 * Two jobs. It lets the domain be exercised end to end with no infrastructure,
 * and it is the executable specification every real adapter is checked against
 * — the same conformance suite runs against this and against the database
 * adapter, so a backing store either behaves identically or fails the build.
 */
export class InMemoryLedgerStore implements TransactionalLedgerStore {
  private readonly entries: Entry[] = []
  private readonly byKey = new Map<string, Entry>()
  private sequence = 0

  async append(proposed: ProposedEntry): Promise<AppendResult> {
    const [result] = await this.appendAll([proposed])
    // appendAll returns one result per input; this is unreachable, but the
    // types should not have to take that on trust.
    if (!result) throw new Error('appendAll returned no result for a single entry')
    return result
  }

  /**
   * All or nothing. Entries are staged and only published once every one of
   * them has been validated, so a rejected transfer leaves no half-written
   * debit behind.
   */
  appendAll(proposed: readonly ProposedEntry[]): Promise<readonly AppendResult[]> {
    const staged: Entry[] = []
    const results: AppendResult[] = []

    for (const candidate of proposed) {
      const existing = this.byKey.get(candidate.idempotencyKey)
      if (existing) {
        results.push({ entry: existing, deduplicated: true })
        continue
      }

      const entry: Entry = { ...candidate, id: `entry_${++this.sequence}` }
      staged.push(entry)
      results.push({ entry, deduplicated: false })
    }

    for (const entry of staged) {
      this.entries.push(entry)
      this.byKey.set(entry.idempotencyKey, entry)
    }

    return Promise.resolve(results)
  }

  readState(identityId: string, assetId: string): Promise<LedgerState> {
    const head = this.entries
      .filter((e) => e.identityId === identityId && e.assetId === assetId)
      .at(-1)
    return Promise.resolve({
      balance: head?.balanceAfter ?? ZERO,
      headHash: head?.hash ?? null,
    })
  }

  readEntries(identityId: string, assetId?: string): Promise<readonly Entry[]> {
    return Promise.resolve(
      this.entries.filter(
        (e) => e.identityId === identityId && (assetId === undefined || e.assetId === assetId),
      ),
    )
  }

  findByIdempotencyKey(key: string): Promise<Entry | null> {
    return Promise.resolve(this.byKey.get(key) ?? null)
  }

  /** Test affordance: total entries held. Not part of the port. */
  get size(): number {
    return this.entries.length
  }
}
