import { describe, expect, it } from 'vitest'
import {
  InMemoryLedgerStore,
  InsufficientForConsumptionError,
  LedgerError,
  canConsume,
  isTransactional,
  post,
  minor,
  postConsume,
  shortfalls,
  verifyChain,
  type Asset,
  type ConsumptionCost,
  type LedgerState,
} from '../src/index.js'

/**
 * The building primitive.
 *
 * A build costs several things at once and the only acceptable outcome of an
 * unaffordable one is that nothing is spent. These tests are named after the
 * failure rather than the function, because the failure is the reason the
 * function exists.
 */

const asset = (id: string, slug: string, symbol: string): Asset => ({
  id,
  slug,
  symbol,
  decimals: 0,
  class: 'COMMODITY_UNIT',
  tenantId: 'flashy',
})

const wood = asset('asset_wood', 'wood', 'WOOD')
const stone = asset('asset_stone', 'stone', 'STONE')
const wheat = asset('asset_wheat', 'wheat', 'WHEAT')

const AT = new Date('2026-08-20T00:00:00.000Z')
const held = (balance: number): LedgerState => ({ balance: minor(balance), headHash: null })

const cost = (a: Asset, amount: number, balance: number): ConsumptionCost => ({
  asset: a,
  amount: minor(amount),
  state: held(balance),
})

/**
 * Run something that should throw and hand back what it threw.
 *
 * try/catch into a `let` leaves the binding possibly-undefined, which is only
 * resolved at the assertion by a non-null assertion — and this suite is about
 * a function whose whole job is refusing to assume. Narrowing at the callsite
 * keeps that honest.
 */
const capture = (fn: () => unknown): unknown => {
  try {
    fn()
  } catch (error) {
    return error
  }
  return undefined
}

const build = (costs: readonly ConsumptionCost[], key = 'build:hut:identity_1') => ({
  tenantId: 'flashy',
  identityId: 'identity_1',
  costs,
  source: { type: 'build', id: 'hut', description: 'a hut' },
  idempotencyKey: key,
  occurredAt: AT,
})

describe('a build that cannot be afforded', () => {
  it('destroys nothing — not even the assets it could have paid for', () => {
    // The exit criterion, stated as the roadmap states it: a build that cannot
    // afford stone destroys no wood. A partial spend leaves a player poorer
    // with nothing to show for it, and no entry saying why.
    expect(() =>
      postConsume(build([cost(wood, 40, 100), cost(stone, 12, 3)])),
    ).toThrow(InsufficientForConsumptionError)
  })

  it('reports every shortfall, not the first one found', () => {
    // Otherwise a player discovers their own bill one line at a time: told they
    // are short of stone, gathers stone, then told they are short of wheat.
    const thrown = capture(() =>
      postConsume(build([cost(wood, 40, 100), cost(stone, 12, 3), cost(wheat, 5, 1)])),
    )

    expect(thrown).toBeInstanceOf(InsufficientForConsumptionError)
    if (!(thrown instanceof InsufficientForConsumptionError)) return

    expect(thrown.shortfalls.map((s) => s.assetId)).toEqual(['asset_stone', 'asset_wheat'])
    expect(thrown.shortfalls[0]).toMatchObject({ available: 3, required: 12, short: 9 })
    expect(thrown.code).toBe('INSUFFICIENT_FOR_CONSUMPTION')
  })

  it('can be asked about before it is attempted, by the same code that enforces it', () => {
    // A build button that greys out beats one that throws — but only if the
    // preview cannot disagree with the rule. Same function, both jobs.
    const bill = [cost(wood, 40, 100), cost(stone, 12, 3)]
    expect(canConsume(bill)).toBe(false)
    expect(shortfalls(bill)).toHaveLength(1)
    expect(canConsume([cost(wood, 40, 100)])).toBe(true)
  })

  it('treats exact affordability as affordable, and one short as short', () => {
    expect(canConsume([cost(stone, 12, 12)])).toBe(true)
    expect(canConsume([cost(stone, 12, 11)])).toBe(false)
  })
})

describe('a build that can be afforded', () => {
  const entries = postConsume(build([cost(wood, 40, 100), cost(stone, 12, 30)]))

  it('produces one debit per asset, signed the one way this ledger signs debits', () => {
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.amount)).toEqual([-40, -12])
    expect(entries.map((e) => e.kind)).toEqual(['SPEND', 'SPEND'])
  })

  it('moves each holding by its own cost, and no other', () => {
    expect(entries[0]).toMatchObject({ assetId: 'asset_wood', balanceBefore: 100, balanceAfter: 60 })
    expect(entries[1]).toMatchObject({ assetId: 'asset_stone', balanceBefore: 30, balanceAfter: 18 })
  })

  it('derives a key per asset, because one key cannot be unique across three entries', () => {
    expect(entries.map((e) => e.idempotencyKey)).toEqual([
      'build:hut:identity_1:consume:asset_wood',
      'build:hut:identity_1:consume:asset_stone',
    ])
  })

  it('carries the source through, so the ledger says what destroyed the wood', () => {
    for (const entry of entries) {
      expect(entry.source).toMatchObject({ type: 'build', id: 'hut' })
    }
  })
})

describe('commands this refuses to interpret', () => {
  it('refuses the same asset twice, which would fork that asset\'s chain', () => {
    // Both lines would be checked against the same balance — 5 and 5 against 8
    // would pass — and both entries would chain onto the same head.
    expect(() => postConsume(build([cost(wood, 5, 8), cost(wood, 5, 8)]))).toThrow(LedgerError)
    try {
      postConsume(build([cost(wood, 5, 8), cost(wood, 5, 8)]))
    } catch (error) {
      expect((error as LedgerError).code).toBe('DUPLICATE_ASSET_IN_COMMAND')
    }
  })

  it('refuses a zero or negative line rather than reading it as a free build', () => {
    expect(() => postConsume(build([cost(wood, 0, 8)]))).toThrow(LedgerError)
    expect(() => postConsume(build([cost(wood, -5, 8)]))).toThrow(LedgerError)
  })

  it('refuses an empty bill, which records nothing', () => {
    expect(() => postConsume(build([]))).toThrow(LedgerError)
  })

  it('refuses to post without an idempotency key', () => {
    expect(() => postConsume(build([cost(wood, 1, 8)], ''))).toThrow(LedgerError)
  })

  it('offers no way to finance a build with debt', () => {
    // post() takes allowNegative; consumption deliberately does not forward it.
    // A build on credit is a different product decision and should have to be
    // written rather than reached by passing a flag.
    const command = build([cost(wood, 40, 10)]) as Record<string, unknown>
    command.allowNegative = true
    expect(() => postConsume(command as Parameters<typeof postConsume>[0])).toThrow(
      InsufficientForConsumptionError,
    )
  })
})

/** Put some of an asset in an identity's hands, the way the ledger would. */
async function gather(store: InMemoryLedgerStore, a: Asset, amount: number) {
  const ref = { tenantId: 'flashy', identityId: 'identity_1', assetId: a.id }
  const state = await store.readState(ref)
  await store.append(
    post(state, {
      tenantId: 'flashy',
      identityId: 'identity_1',
      asset: a,
      amount: minor(amount),
      kind: 'EARN',
      source: { type: 'gather' },
      idempotencyKey: `gather:${a.id}`,
      occurredAt: AT,
    }),
  )
}

describe('consumption against a store', () => {
  it('lands every leg together, and each asset keeps its own verifiable chain', async () => {
    const store = new InMemoryLedgerStore()
    expect(isTransactional(store)).toBe(true)

    // Seeded through post(), so the chain being verified below is a real one.
    // Hand-written hashes would make verifyChain fail on the seed and say
    // nothing about the entries under test.
    await gather(store, wood, 100)
    await gather(store, stone, 30)

    const states = await Promise.all(
      [wood, stone].map((a) =>
        store.readState({ tenantId: 'flashy', identityId: 'identity_1', assetId: a.id }),
      ),
    )

    const [woodState, stoneState] = states
    if (!woodState || !stoneState) throw new Error('seeded states missing')

    const entries = postConsume(
      build([
        { asset: wood, amount: minor(40), state: woodState },
        { asset: stone, amount: minor(12), state: stoneState },
      ]),
    )

    // appendAll, never append in a loop: a loop that fails on the third leg has
    // spent the first two, which is this function's failure moved one layer down.
    await store.appendAll(entries)

    for (const [a, expected] of [
      [wood, 60],
      [stone, 18],
    ] as const) {
      const ref = { tenantId: 'flashy', identityId: 'identity_1', assetId: a.id }
      expect((await store.readState(ref)).balance).toBe(expected)
      expect(verifyChain(await store.readEntries(ref)).valid).toBe(true)
    }
  })

  it('deduplicates a replayed build leg by leg, without the caller tracking legs', async () => {
    const store = new InMemoryLedgerStore()
    await gather(store, wood, 100)

    const ref = { tenantId: 'flashy', identityId: 'identity_1', assetId: wood.id }
    const first = postConsume(build([{ asset: wood, amount: minor(40), state: await store.readState(ref) }]))
    await store.appendAll(first)

    // The retry recomputes from the post-spend state, so its entry differs —
    // but the derived key is the same, so the store returns the original.
    const replay = postConsume(build([{ asset: wood, amount: minor(40), state: await store.readState(ref) }]))
    const results = await store.appendAll(replay)

    expect(results.every((r) => r.deduplicated)).toBe(true)
    expect((await store.readState(ref)).balance).toBe(60)
  })
})
