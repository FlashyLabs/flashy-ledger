import type { Entry } from './entry.js'
import { ZERO, add, type Minor } from './money.js'
import type { LedgerState } from './post.js'

/**
 * A balance is a fold over entries. Any stored balance is a cache of this
 * function's result and must be rebuildable from it at any time, which is what
 * lets projections be rebuilt, sharded, or thrown away without risk.
 */
export function balanceOf(entries: readonly Entry[]): Minor {
  return entries.reduce<Minor>((total, entry) => add(total, entry.amount), ZERO)
}

/** Balances per asset, for an identity holding more than one. */
export function balancesByAsset(entries: readonly Entry[]): ReadonlyMap<string, Minor> {
  const balances = new Map<string, Minor>()
  for (const entry of entries) {
    balances.set(entry.assetId, add(balances.get(entry.assetId) ?? ZERO, entry.amount))
  }
  return balances
}

/** The state a new entry for this identity should build on. */
export function stateFrom(entries: readonly Entry[]): LedgerState {
  const head = entries.at(-1)
  return { balance: head?.balanceAfter ?? ZERO, headHash: head?.hash ?? null }
}
