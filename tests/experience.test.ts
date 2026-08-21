import { describe, expect, it } from 'vitest'
import {
  InMemoryLedgerStore,
  LedgerError,
  SKILL_KEYS,
  isTransferable,
  minor,
  post,
  postTransfer,
  skillAsset,
  skillAssetRegistry,
  skillAssets,
  skillForAssetId,
  verifyChain,
  xpIdempotencyKey,
  type Asset,
  type LedgerState,
} from '../src/index.js'

/** The rejection code a call produces, or null if it did not reject. */
function codeOf(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (err) {
    return err instanceof LedgerError ? err.code : 'NOT_A_LEDGER_ERROR'
  }
}

const TENANT = 'flashy'
const EMPTY: LedgerState = { balance: minor(0), headHash: null }

const gold: Asset = {
  id: 'asset_fg',
  slug: 'flashy-gold',
  symbol: 'FG',
  decimals: 2,
  class: 'REWARD_CURRENCY',
  tenantId: TENANT,
}

describe('skill assets', () => {
  it('gives every skill a zero-decimal SKILL_XP asset', () => {
    for (const skill of SKILL_KEYS) {
      const asset = skillAsset(skill, TENANT)
      expect(asset.class).toBe('SKILL_XP')
      // XP is indivisible. Half a point of Instinct is not a thing anyone earned.
      expect(asset.decimals).toBe(0)
      expect(asset.tenantId).toBe(TENANT)
    }
  })

  it('pins the asset ids, because they are inside every entry hash', () => {
    // Renaming one of these does not migrate a chain, it invalidates one. The
    // literals are written out so the change has to be made here, on purpose.
    expect(SKILL_KEYS.map((s) => skillAsset(s, TENANT).id)).toEqual([
      'xp-int',
      'xp-str',
      'xp-ins',
      'xp-inf',
      'xp-com',
    ])
  })

  it('round-trips an asset id back to its skill', () => {
    for (const skill of SKILL_KEYS) {
      expect(skillForAssetId(skillAsset(skill, TENANT).id)).toBe(skill)
    }
    expect(skillForAssetId('asset_fg')).toBeNull()
  })

  it('keeps skill assets separate per tenant while ids stay stable', () => {
    expect(skillAsset('STRATEGY', 'other').tenantId).toBe('other')
    expect(skillAsset('STRATEGY', 'other').id).toBe(skillAsset('STRATEGY', TENANT).id)
  })

  it('registers all five', () => {
    expect(skillAssets(TENANT)).toHaveLength(5)
    expect(skillAssetRegistry(TENANT).get('xp-com')?.symbol).toBe('COM')
  })
})

describe('XP is not transferable', () => {
  it('refuses to move a skill asset between identities', () => {
    const xp = skillAsset('INTELLIGENCE', TENANT)
    const from = { state: { balance: minor(500), headHash: null }, identityId: 'a' }
    const to = { state: EMPTY, identityId: 'b' }

    expect(
      codeOf(() =>
        postTransfer(from, to, {
          tenantId: TENANT,
          asset: xp,
          amount: minor(100),
          source: { type: 'gift', id: 'g_1' },
          idempotencyKey: 'gift:g_1',
          occurredAt: new Date('2026-08-21T00:00:00Z'),
        }),
      ),
    ).toBe('ASSET_NOT_TRANSFERABLE')
  })

  it('still moves currency and commodities', () => {
    const from = { state: { balance: minor(500), headHash: null }, identityId: 'a' }
    const to = { state: EMPTY, identityId: 'b' }
    const wheat: Asset = { ...gold, id: 'wheat', slug: 'wheat', symbol: 'WHT', decimals: 0, class: 'COMMODITY_UNIT' }

    for (const asset of [gold, wheat]) {
      const [debit, credit] = postTransfer(from, to, {
        tenantId: TENANT,
        asset,
        amount: minor(100),
        source: { type: 'raid', id: 'r_1' },
        idempotencyKey: `raid:r_1:${asset.id}`,
        occurredAt: new Date('2026-08-21T00:00:00Z'),
      })
      expect(debit.amount).toBe(-100)
      expect(credit.amount).toBe(100)
    }
  })

  it('reports transferability by class', () => {
    expect(isTransferable(gold)).toBe(true)
    expect(isTransferable(skillAsset('COMMERCE', TENANT))).toBe(false)
  })
})

describe('XP posts like everything else', () => {
  it('earns, chains and verifies on the shared books', async () => {
    const store = new InMemoryLedgerStore()
    const xp = skillAsset('INTELLIGENCE', TENANT)
    let state: LedgerState = EMPTY

    for (const lesson of ['l_1', 'l_2', 'l_3']) {
      const entry = post(state, {
        tenantId: TENANT,
        identityId: 'hunter_1',
        asset: xp,
        amount: minor(5),
        kind: 'EARN',
        source: { type: 'lesson', id: lesson },
        idempotencyKey: xpIdempotencyKey('academy', 'lesson_completed', lesson, 'hunter_1'),
        occurredAt: new Date('2026-08-21T00:00:00Z'),
      })
      await store.append(entry)
      state = { balance: entry.balanceAfter, headHash: entry.hash }
    }

    expect(state.balance).toBe(15)
    const entries = await store.readEntries({ tenantId: TENANT, identityId: 'hunter_1', assetId: xp.id })
    expect(verifyChain(entries).valid).toBe(true)
  })

  it('rejects an XP debit that would go negative, like any other asset', () => {
    expect(() =>
      post(EMPTY, {
        tenantId: TENANT,
        identityId: 'hunter_1',
        asset: skillAsset('STRATEGY', TENANT),
        amount: minor(-5),
        kind: 'SPEND',
        source: { type: 'correction', id: 'c_1' },
        idempotencyKey: 'c_1',
        occurredAt: new Date('2026-08-21T00:00:00Z'),
      }),
    ).toThrowError(LedgerError)
  })
})

describe('xpIdempotencyKey', () => {
  it('builds the same key from the same facts, in every product', () => {
    expect(xpIdempotencyKey('academy', 'lesson_completed', 'l_42', 'hunter_1')).toBe(
      'academy:lesson_completed:l_42:hunter_1',
    )
  })

  it('separates the products awarding the same activity', () => {
    const a = xpIdempotencyKey('academy', 'quiz_perfect', 'q_1', 'hunter_1')
    const b = xpIdempotencyKey('claimyourgold', 'quiz_perfect', 'q_1', 'hunter_1')
    expect(a).not.toBe(b)
  })

  it('collides on a repeat, which is the entire point', () => {
    // Two workers processing the same completion must produce one key, so the
    // store's uniqueness constraint pays the hunter once.
    const first = xpIdempotencyKey('academy', 'module_passed', 'm_7', 'hunter_1')
    const retry = xpIdempotencyKey('academy', 'module_passed', 'm_7', 'hunter_1')
    expect(retry).toBe(first)
  })
})

describe('LedgerError surface', () => {
  it('carries a switchable code', () => {
    try {
      postTransfer(
        { state: { balance: minor(10), headHash: null }, identityId: 'a' },
        { state: EMPTY, identityId: 'b' },
        {
          tenantId: TENANT,
          asset: skillAsset('INSTINCT', TENANT),
          amount: minor(1),
          source: { type: 'gift', id: 'g' },
          idempotencyKey: 'g',
          occurredAt: new Date('2026-08-21T00:00:00Z'),
        },
      )
      expect.unreachable('transfer of XP should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(LedgerError)
      expect((err as LedgerError).code).toBe('ASSET_NOT_TRANSFERABLE')
    }
  })
})
