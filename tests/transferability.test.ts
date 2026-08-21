import { describe, expect, it } from 'vitest'
import {
  LedgerError,
  isTransferable,
  minor,
  postTransfer,
  skillAsset,
  type Asset,
  type LedgerState,
} from '../src/index.js'

/**
 * XP is status, gold is money.
 *
 * The asset-class comment has said "never convertible" since the experience
 * domain landed, and until now nothing enforced the half the ledger can see.
 * These cases are the enforcement: a skill asset cannot change hands.
 */

const TENANT = 'flashy'
const AT = new Date('2026-08-21T00:00:00Z')
const EMPTY: LedgerState = { balance: minor(0), headHash: null }

const gold: Asset = {
  id: 'asset_fg', slug: 'flashy-gold', symbol: 'FG',
  decimals: 2, class: 'REWARD_CURRENCY', tenantId: TENANT,
}
const wheat: Asset = {
  id: 'asset_wheat', slug: 'wheat', symbol: 'WHT',
  decimals: 0, class: 'COMMODITY_UNIT', tenantId: TENANT,
}
const credit: Asset = {
  id: 'asset_pc', slug: 'partner-credit', symbol: 'PC',
  decimals: 2, class: 'PARTNER_CREDIT', tenantId: TENANT,
}

const funded = (identityId: string) => ({
  state: { balance: minor(500), headHash: null },
  identityId,
})

/** The rejection code a call produces, or null if it did not reject. */
function codeOf(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (err) {
    return err instanceof LedgerError ? err.code : 'NOT_A_LEDGER_ERROR'
  }
}

function transfer(asset: Asset) {
  return () =>
    postTransfer(funded('identity_a'), { state: EMPTY, identityId: 'identity_b' }, {
      tenantId: TENANT,
      asset,
      amount: minor(100),
      source: { type: 'gift', id: 'g_1' },
      idempotencyKey: `gift:g_1:${asset.id}`,
      occurredAt: AT,
    })
}

describe('isTransferable', () => {
  it('admits every class that represents a holding', () => {
    expect(isTransferable(gold)).toBe(true)
    expect(isTransferable(wheat)).toBe(true)
    expect(isTransferable(credit)).toBe(true)
  })

  it('refuses skill experience', () => {
    expect(isTransferable(skillAsset('INTELLIGENCE', TENANT))).toBe(false)
  })
})

describe('postTransfer', () => {
  it('rejects a skill asset, whichever skill it is', () => {
    for (const skill of ['INTELLIGENCE', 'STRATEGY', 'INSTINCT', 'INFLUENCE', 'COMMERCE'] as const) {
      expect(codeOf(transfer(skillAsset(skill, TENANT)))).toBe('ASSET_NOT_TRANSFERABLE')
    }
  })

  it('produces no entries at all when it rejects', () => {
    // A partial transfer is worse than a refused one: a debit written without
    // its credit is money that left one identity and reached nobody.
    let produced: unknown = 'not called'
    try {
      produced = transfer(skillAsset('COMMERCE', TENANT))()
    } catch {
      /* expected */
    }
    expect(produced).toBe('not called')
  })

  it('names the asset and its class in the message', () => {
    try {
      transfer(skillAsset('INFLUENCE', TENANT))()
      expect.unreachable('an XP transfer should throw')
    } catch (err) {
      expect((err as LedgerError).message).toContain('xp-influence')
      expect((err as LedgerError).message).toContain('SKILL_XP')
    }
  })

  it('still moves currency, commodities and partner credit', () => {
    for (const asset of [gold, wheat, credit]) {
      const [debit, creditEntry] = transfer(asset)()
      expect(debit.amount).toBe(-100)
      expect(creditEntry.amount).toBe(100)
      expect(debit.assetId).toBe(asset.id)
    }
  })

  it('checks transferability before the amount is spendable, not after', () => {
    // An unaffordable XP transfer must fail as untransferable, not as
    // insufficient — otherwise topping the balance up would "fix" it.
    const broke = { state: EMPTY, identityId: 'identity_a' }
    expect(
      codeOf(() =>
        postTransfer(broke, { state: EMPTY, identityId: 'identity_b' }, {
          tenantId: TENANT,
          asset: skillAsset('STRATEGY', TENANT),
          amount: minor(100),
          source: { type: 'gift', id: 'g_2' },
          idempotencyKey: 'gift:g_2',
          occurredAt: AT,
        }),
      ),
    ).toBe('ASSET_NOT_TRANSFERABLE')
  })

  it('rejects a zero amount before it reaches the class check', () => {
    // Ordering matters only so the message a caller sees names the real fault.
    expect(
      codeOf(() =>
        postTransfer(funded('identity_a'), { state: EMPTY, identityId: 'identity_b' }, {
          tenantId: TENANT,
          asset: skillAsset('INSTINCT', TENANT),
          amount: minor(0),
          source: { type: 'gift', id: 'g_3' },
          idempotencyKey: 'gift:g_3',
          occurredAt: AT,
        }),
      ),
    ).toBe('ZERO_AMOUNT')
  })
})
