import { describe, expect, it } from 'vitest'
import {
  InMemoryLedgerStore,
  LedgerError,
  PrecisionError,
  SKILL_KEYS,
  fromDecimal,
  minor,
  post,
  skillAsset,
  skillAssetRegistry,
  skillAssets,
  skillForAssetId,
  verifyChain,
  xpIdempotencyKey,
  type LedgerState,
} from '../src/index.js'

const AT = new Date('2026-08-14T00:00:00.000Z')
const EMPTY: LedgerState = { balance: minor(0), headHash: null }

const int = skillAsset('INTELLIGENCE', 'flashy')

function earn(state: LedgerState, amount: number, key: string, over: Record<string, unknown> = {}) {
  return post(state, {
    tenantId: 'flashy',
    identityId: 'hunter_1',
    asset: int,
    amount: minor(amount),
    kind: 'EARN',
    source: { type: 'academy_module_passed', id: 'mod_7' },
    idempotencyKey: key,
    occurredAt: AT,
    ...over,
  })
}

describe('skill assets', () => {
  it('defines exactly the five boardroom skills', () => {
    expect(SKILL_KEYS).toEqual([
      'INTELLIGENCE',
      'STRATEGY',
      'INSTINCT',
      'INFLUENCE',
      'COMMERCE',
    ])
    expect(skillAssets('flashy')).toHaveLength(5)
  })

  it('every skill asset is indivisible, SKILL_XP class, tenant-scoped', () => {
    for (const asset of skillAssets('flashy')) {
      expect(asset.decimals).toBe(0)
      expect(asset.class).toBe('SKILL_XP')
      expect(asset.tenantId).toBe('flashy')
    }
  })

  it('asset ids are stable and reverse-resolvable', () => {
    expect(int.id).toBe('xp-int')
    expect(skillForAssetId('xp-int')).toBe('INTELLIGENCE')
    expect(skillForAssetId('xp-com')).toBe('COMMERCE')
    expect(skillForAssetId('asset_fg')).toBeNull()
    expect(skillAssetRegistry('flashy').get('xp-str')?.symbol).toBe('STR')
  })

  it('rejects fractional XP — zero decimals means indivisible', () => {
    expect(() => fromDecimal(1.5, int.decimals)).toThrow(PrecisionError)
    expect(fromDecimal(15, int.decimals)).toBe(15)
  })
})

describe('posting XP', () => {
  it('earns XP with a hash-chained entry, same discipline as gold', () => {
    const first = earn(EMPTY, 15, xpIdempotencyKey('flashy-academy', 'academy_module_passed', 'mod_7', 'hunter_1'))
    expect(first.balanceAfter).toBe(15)
    expect(first.previousHash).toBeNull()

    const second = earn(
      { balance: first.balanceAfter, headHash: first.hash },
      40,
      xpIdempotencyKey('flashy-academy', 'academy_certificate_earned', 'track_2', 'hunter_1'),
      { source: { type: 'academy_certificate_earned', id: 'track_2' } },
    )
    expect(second.balanceAfter).toBe(55)
    expect(second.previousHash).toBe(first.hash)
  })

  it('a MIGRATION entry backfills a legacy balance without pretending it was earned today', () => {
    const migrated = earn(EMPTY, 1200, 'migration:legacy-xp:hunter_1', {
      kind: 'MIGRATION',
      source: { type: 'legacy_xp_balance' },
    })
    expect(migrated.kind).toBe('MIGRATION')
    expect(migrated.balanceAfter).toBe(1200)
  })

  it('a DECAY entry is explicit negative movement, never a mutation', () => {
    const start = earn(EMPTY, 100, 'k1')
    const decayed = earn(
      { balance: start.balanceAfter, headHash: start.hash },
      -30,
      'decay:2026-09:hunter_1',
      { kind: 'DECAY', source: { type: 'seasonal_decay' } },
    )
    expect(decayed.balanceAfter).toBe(70)
  })

  it('XP cannot go negative — decay stops at the floor', () => {
    const start = earn(EMPTY, 10, 'k1')
    expect(() =>
      earn({ balance: start.balanceAfter, headHash: start.hash }, -30, 'decay:k', {
        kind: 'DECAY',
        source: { type: 'seasonal_decay' },
      }),
    ).toThrow(LedgerError)
  })

  it('a full skill history verifies as a chain', async () => {
    const store = new InMemoryLedgerStore()
    let state = await store.readState('hunter_1', int.id)
    for (const [i, amount] of [15, 15, 40, 5].entries()) {
      const entry = earn(state, amount, `k${i}`)
      await store.append(entry)
      state = await store.readState('hunter_1', int.id)
    }
    const entries = await store.readEntries('hunter_1', int.id)
    expect(verifyChain(entries).valid).toBe(true)
    expect(state.balance).toBe(75)
  })

  it('replaying an idempotency key writes nothing — a module is passed once, ever', async () => {
    const store = new InMemoryLedgerStore()
    const key = xpIdempotencyKey('flashy-academy', 'academy_module_passed', 'mod_7', 'hunter_1')
    await store.append(earn(EMPTY, 15, key))
    const replay = await store.append(earn(EMPTY, 15, key))
    expect(replay.deduplicated).toBe(true)
    expect(store.size).toBe(1)
  })
})
