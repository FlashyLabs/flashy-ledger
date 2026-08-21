import { describe, expect, it } from 'vitest'
import {
  LedgerError,
  NaturalKeyError,
  assertOpaqueIdentity,
  fromDecimal,
  looksLikeNaturalKey,
  minor,
  post,
  surrogateIdentity,
  type Asset,
  type LedgerState,
} from '../src/index.js'

/**
 * The identity rule.
 *
 * Two halves, and the second is the one that matters. The first is the design
 * decision: the ledger keys on an opaque, tenant-scoped identifier. The second
 * is that a decision written down does not stop a service passing an email
 * because it was the value to hand, and an email hashed into an append-only
 * public chain cannot be taken back out.
 *
 * These tests are as concerned with what the guard MUST NOT reject as with what
 * it must. A guard with false positives gets disabled, and a disabled guard
 * checks nothing.
 */

const GOLD: Asset = {
  id: 'asset_fg',
  slug: 'flashy-gold',
  symbol: 'FG',
  decimals: 2,
  class: 'REWARD_CURRENCY',
  tenantId: 'flashy',
}

const EMPTY: LedgerState = { balance: minor(0), headHash: null }

const postAs = (identityId: string) =>
  post(EMPTY, {
    tenantId: 'flashy',
    identityId,
    asset: GOLD,
    amount: fromDecimal(25, GOLD.decimals),
    kind: 'EARN',
    source: { type: 'quest', id: 'q_1' },
    idempotencyKey: 'quest:q_1',
    occurredAt: new Date('2026-08-21T00:00:00.000Z'),
  })

describe('identifiers that name a person', () => {
  const rejected: readonly [string, string][] = [
    ['an email address', 'michael@gda.capital'],
    ['an email address', 'first.last+tag@sub.example.co.uk'],
    ['a phone number', '+14165551234'],
    ['a phone number', '+1 (416) 555-1234'],
    ['an EVM wallet address', '0x71C7656EC7ab88b098defB751B7401B5f6d8976F'],
    ['a public key or raw digest', `0x${'ab'.repeat(32)}`],
    ['a TON wallet address', 'EQCcSF8U8XFvNMFRUEyIRuKjHYUL8vGBUgpqLwUJMSY45SLh'],
  ]

  it.each(rejected)('refuses %s: %s', (kind, value) => {
    expect(looksLikeNaturalKey(value)).toBe(kind)
    expect(() => {
      assertOpaqueIdentity(value)
    }).toThrow(NaturalKeyError)
  })

  it('refuses at post(), so no entry can be written that skips the check', () => {
    // The guard is only worth anything if it sits on the one path every entry
    // takes. A helper a caller may forget to call is a comment.
    expect(() => postAs('michael@gda.capital')).toThrow(NaturalKeyError)
    expect(() => postAs('0x71C7656EC7ab88b098defB751B7401B5f6d8976F')).toThrow(NaturalKeyError)
  })

  it('says what was wrong and what to do instead', () => {
    // An error that only refuses teaches nothing; the next person writes a
    // workaround. This one names the fix.
    try {
      assertOpaqueIdentity('michael@gda.capital')
      expect.unreachable('should have thrown')
    } catch (error) {
      const e = error as NaturalKeyError
      expect(e.code).toBe('NATURAL_KEY_IDENTITY')
      expect(e.message).toContain('an email address')
      expect(e.message).toContain('cannot be removed once hashed')
      expect(e.message).toContain('surrogateIdentity')
    }
  })

  it('refuses an empty identity, which belongs to nobody', () => {
    expect(() => {
      assertOpaqueIdentity('')
    }).toThrow(LedgerError)
    expect(() => {
      assertOpaqueIdentity('   ')
    }).toThrow(LedgerError)
  })
})

describe('identifiers it must not touch', () => {
  // This block is the reason the guard can stay switched on. Every value here
  // is one a real consumer uses today or plausibly will.
  const allowed: readonly [string, string][] = [
    ['a MongoDB ObjectId, as ClaimYour.Gold uses', '65f1a2b3c4d5e6f708192a3b'],
    ['a ULID', '01K2F7QW3M8T4V6X9YB0CDEFGH'],
    ['a UUID', '3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
    ['a bare integer', '10047'],
    ['a nanoid', 'V1StGXR8_Z5jdHi6B-myT'],
    ['a prefixed surrogate', 'identity_1'],
    ['a sha256 surrogate with no 0x', 'a'.repeat(64)],
    ['a short digit run that is not E.164', '5551234'],
    ['a bare address with no 0x prefix', '71C7656EC7ab88b098defB751B7401B5f6d8976F'],
  ]

  it.each(allowed)('accepts %s: %s', (_why, value) => {
    expect(looksLikeNaturalKey(value)).toBeNull()
    expect(() => {
      assertOpaqueIdentity(value)
    }).not.toThrow()
    expect(() => postAs(value)).not.toThrow()
  })

  it('does not reject a 24-hex ObjectId as a wallet address', () => {
    // The lengths differ, and the 0x prefix is required. Getting this wrong
    // would break the one consumer this package has.
    const objectId = '65f1a2b3c4d5e6f708192a3b'
    expect(objectId).toHaveLength(24)
    expect(looksLikeNaturalKey(objectId)).toBeNull()
  })
})

describe('the surrogate', () => {
  const SALT = 'a-sufficiently-long-tenant-salt'
  const OTHER = 'a-different-tenant-salt-entirely'

  it('is stable, so the same person keeps the same identity', () => {
    expect(surrogateIdentity('michael@gda.capital', SALT)).toBe(
      surrogateIdentity('michael@gda.capital', SALT),
    )
  })

  it('differs per tenant, which is the pairwise property', () => {
    // The same human at two issuers yields two unrelated identifiers, so
    // neither the issuers comparing notes nor a reader of the public record can
    // correlate them — and no coordination between tenants was required.
    expect(surrogateIdentity('michael@gda.capital', SALT)).not.toBe(
      surrogateIdentity('michael@gda.capital', OTHER),
    )
  })

  it('produces something the guard accepts', () => {
    // Otherwise the advice in the error message would be wrong, which is worse
    // than giving no advice.
    const derived = surrogateIdentity('michael@gda.capital', SALT)
    expect(looksLikeNaturalKey(derived)).toBeNull()
    expect(() => postAs(derived)).not.toThrow()
  })

  it('separates the salt from the value, so two inputs cannot collide', () => {
    // Concatenating without a separator makes ("ab", "c") and ("a", "bc")
    // hash identically — two different people, one identity.
    expect(surrogateIdentity('bc', 'a'.repeat(16))).not.toBe(
      surrogateIdentity('c', `${'a'.repeat(16)} b`),
    )
  })

  it('refuses a salt short enough to be brute-forced', () => {
    // With a guessable salt this is a lookup table, not a surrogate: anyone
    // holding it recovers every identity from a list of candidate emails.
    expect(() => surrogateIdentity('michael@gda.capital', 'short')).toThrow(/at least 16/)
  })
})
