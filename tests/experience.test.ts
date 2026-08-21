import { describe, expect, it } from 'vitest'
import {
  SKILL_KEYS,
  minor,
  post,
  skillAsset,
  skillAssetRegistry,
  skillAssets,
  skillForAssetId,
  stateFrom,
  verifyChain,
  xpIdempotencyKey,
  type Entry,
  type SkillKey,
} from '../src/index.js'

/**
 * The experience domain's contract: the five skills are ordinary assets to
 * the engine, their identifiers are part of the hash format and therefore
 * frozen, and XP posts with exactly the discipline gold does. These tests
 * pin the identifiers byte-for-byte — changing one silently un-verifies
 * every chain that ever used it.
 */

const TENANT = 'flashy'

describe('skill assets', () => {
  it('defines exactly the five skills, in canonical order', () => {
    expect(SKILL_KEYS).toEqual(['INTELLIGENCE', 'STRATEGY', 'INSTINCT', 'INFLUENCE', 'COMMERCE'])
    expect(skillAssets(TENANT)).toHaveLength(5)
  })

  it('pins the wire identifiers — these appear in entry hashes and must never drift', () => {
    const byKey = Object.fromEntries(
      SKILL_KEYS.map((k) => [k, skillAsset(k, TENANT)]),
    ) as Record<SkillKey, ReturnType<typeof skillAsset>>
    expect(byKey.INTELLIGENCE).toMatchObject({ id: 'xp-int', slug: 'xp-intelligence', symbol: 'INT' })
    expect(byKey.STRATEGY).toMatchObject({ id: 'xp-str', slug: 'xp-strategy', symbol: 'STR' })
    expect(byKey.INSTINCT).toMatchObject({ id: 'xp-ins', slug: 'xp-instinct', symbol: 'INS' })
    expect(byKey.INFLUENCE).toMatchObject({ id: 'xp-inf', slug: 'xp-influence', symbol: 'INF' })
    expect(byKey.COMMERCE).toMatchObject({ id: 'xp-com', slug: 'xp-commerce', symbol: 'COM' })
  })

  it('every skill is zero-decimal SKILL_XP on the given tenant — XP is indivisible status, not money', () => {
    for (const asset of skillAssets(TENANT)) {
      expect(asset.decimals).toBe(0)
      expect(asset.class).toBe('SKILL_XP')
      expect(asset.tenantId).toBe(TENANT)
    }
  })

  it('registry round-trips and the reverse lookup agrees', () => {
    const registry = skillAssetRegistry(TENANT)
    expect(registry.size).toBe(5)
    for (const key of SKILL_KEYS) {
      const asset = skillAsset(key, TENANT)
      expect(registry.get(asset.id)).toEqual(asset)
      expect(skillForAssetId(asset.id)).toBe(key)
    }
    expect(skillForAssetId('asset_fg')).toBeNull()
  })
})

describe('xpIdempotencyKey', () => {
  it('derives the documented <product>:<activity>:<entityId>:<identityId> shape', () => {
    expect(xpIdempotencyKey('claimyour-gold', 'quest_completed', 'q1', 'c1')).toBe(
      'claimyour-gold:quest_completed:q1:c1',
    )
  })
})

describe('XP on the books', () => {
  it('posts a hash-chained EARN against a skill asset, exactly like money', () => {
    const intelligence = skillAsset('INTELLIGENCE', TENANT)
    // post() is pure; persistence assigns the id. Materialize the way a
    // store would, so verifyChain sees real Entries.
    const first: Entry = {
      ...post(stateFrom([]), {
        tenantId: TENANT,
        identityId: 'hunter-1',
        asset: intelligence,
        amount: minor(25),
        kind: 'EARN',
        source: { type: 'academy_module_passed', id: 'mod-1' },
        idempotencyKey: xpIdempotencyKey('flashy-academy', 'academy_module_passed', 'mod-1', 'hunter-1'),
        occurredAt: new Date('2026-08-20T00:00:00Z'),
      }),
      id: 'xp-e-1',
    }
    const second: Entry = {
      ...post(stateFrom([first]), {
        tenantId: TENANT,
        identityId: 'hunter-1',
        asset: intelligence,
        amount: minor(10),
        kind: 'EARN',
        source: { type: 'quiz_passed', id: 'quiz-9' },
        idempotencyKey: xpIdempotencyKey('flashy-academy', 'quiz_passed', 'quiz-9', 'hunter-1'),
        occurredAt: new Date('2026-08-20T01:00:00Z'),
      }),
      id: 'xp-e-2',
    }

    expect(second.balanceAfter).toEqual(minor(35))
    expect(second.previousHash).toBe(first.hash)
    expect(verifyChain([first, second]).valid).toBe(true)
  })

  it('accepts the DECAY kind as an explicit negative entry — loss is posted, never mutated', () => {
    const instinct = skillAsset('INSTINCT', TENANT)
    const earn: Entry = {
      ...post(stateFrom([]), {
        tenantId: TENANT,
        identityId: 'hunter-2',
        asset: instinct,
        amount: minor(40),
        kind: 'EARN',
        source: { type: 'streak_week' },
        idempotencyKey: 'claimyour-gold:streak_week:w34:hunter-2',
        occurredAt: new Date('2026-08-20T00:00:00Z'),
      }),
      id: 'xp-e-3',
    }
    const decay: Entry = {
      ...post(stateFrom([earn]), {
        tenantId: TENANT,
        identityId: 'hunter-2',
        asset: instinct,
        amount: minor(-5),
        kind: 'DECAY',
        source: { type: 'seasonal_decay', description: 'season 3 close' },
        idempotencyKey: 'claimyour-gold:seasonal_decay:s3:hunter-2',
        occurredAt: new Date('2026-08-21T00:00:00Z'),
      }),
      id: 'xp-e-4',
    }
    expect(decay.balanceAfter).toEqual(minor(35))
    expect(verifyChain([earn, decay]).valid).toBe(true)
  })
})
