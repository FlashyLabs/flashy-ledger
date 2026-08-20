import type { Asset } from './asset.js'
import type { EntrySource } from './entry.js'
import { post, type LedgerState, type PostCommand, type ProposedEntry } from './post.js'
import { add, isNegative, isZero, negate, type Minor } from './money.js'
import {
  duplicateAssetInCommand,
  missingIdempotencyKey,
  zeroAmount,
  InsufficientForConsumptionError,
  type Shortfall,
} from './errors.js'

/**
 * Multi-asset consumption: the primitive building needs.
 *
 * A build costs several things at once — 40 wood, 12 stone, 3 wheat — and the
 * only acceptable outcome of an unaffordable build is that nothing at all is
 * spent. The failure this exists to prevent is the partial one: wood debited,
 * stone found short, and a player left poorer with nothing to show for it. That
 * bug does not announce itself. It shows up as a support ticket about missing
 * resources, weeks later, with no entry anywhere saying what happened.
 *
 * So sufficiency is decided for every asset before a single entry is produced.
 * The function is pure, like the rest of the domain: it returns the entries that
 * should exist, or it throws having produced none. Writing them is the store's
 * job, and it must write them together — see `postConsume`'s note on atomicity.
 */

/** One line of a bill: how much of what, and that holding's current state. */
export interface ConsumptionCost {
  readonly asset: Asset
  /** Positive. The direction is the function's, not the caller's, to decide. */
  readonly amount: Minor
  readonly state: LedgerState
}

export type ConsumeCommand = Pick<
  PostCommand,
  'tenantId' | 'identityId' | 'idempotencyKey' | 'occurredAt' | 'metadata'
> & {
  readonly costs: readonly ConsumptionCost[]
  readonly source: EntrySource
}

/**
 * Every asset that cannot cover its cost, or an empty list.
 *
 * Exported because a caller usually wants to ask before it commits — a build
 * button that greys out is a better product than one that throws. The check and
 * the enforcement are the same code, so the preview cannot drift from the rule.
 */
export function shortfalls(costs: readonly ConsumptionCost[]): readonly Shortfall[] {
  const found: Shortfall[] = []

  for (const cost of costs) {
    const remaining = add(cost.state.balance, negate(cost.amount))
    if (isNegative(remaining)) {
      found.push({
        assetId: cost.asset.id,
        available: cost.state.balance,
        required: cost.amount,
        short: -remaining,
      })
    }
  }

  return found
}

/** Whether a bill can be paid in full right now. */
export function canConsume(costs: readonly ConsumptionCost[]): boolean {
  return shortfalls(costs).length === 0
}

/**
 * The entries a consumption should produce: one debit per asset, or nothing.
 *
 * Each carries a derived idempotency key — `${key}:consume:${assetId}` — for the
 * same reason a transfer's two legs do. One key across several entries cannot be
 * unique, and a per-asset key derived from the caller's means a retry of the
 * whole command deduplicates leg by leg without the caller tracking which legs
 * landed.
 *
 * `allowNegative` is deliberately not accepted. Consumption is destruction of
 * something held; a build financed by debt is a different product decision, and
 * it should have to be written rather than reached by passing a flag.
 *
 * ── On atomicity ────────────────────────────────────────────────────────────
 *
 * This function guarantees that an unaffordable bill produces no entries. It
 * cannot guarantee that an affordable one is written completely — that is the
 * store's, and only a `TransactionalLedgerStore` can promise it. Pass these
 * entries to `appendAll`, never to `append` in a loop: a loop that fails on the
 * third leg has spent the first two, which is the exact failure this function
 * exists to prevent, moved one layer down.
 */
export function postConsume(command: ConsumeCommand): readonly ProposedEntry[] {
  if (!command.idempotencyKey) throw missingIdempotencyKey()
  if (command.costs.length === 0) throw zeroAmount()

  const seen = new Set<string>()
  for (const cost of command.costs) {
    // A zero or negative line is a caller bug, not a free build.
    if (isZero(cost.amount) || isNegative(cost.amount)) throw zeroAmount()
    if (seen.has(cost.asset.id)) throw duplicateAssetInCommand(cost.asset.id)
    seen.add(cost.asset.id)
  }

  // Every line, before any entry. This ordering is the whole point of the file.
  const short = shortfalls(command.costs)
  if (short.length > 0) throw new InsufficientForConsumptionError(short)

  return command.costs.map((cost) =>
    post(cost.state, {
      tenantId: command.tenantId,
      identityId: command.identityId,
      asset: cost.asset,
      amount: negate(cost.amount),
      kind: 'SPEND',
      source: command.source,
      idempotencyKey: `${command.idempotencyKey}:consume:${cost.asset.id}`,
      occurredAt: command.occurredAt,
      metadata: command.metadata,
    }),
  )
}
