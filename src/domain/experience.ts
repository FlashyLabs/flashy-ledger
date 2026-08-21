import { assetRegistry, type Asset } from './asset.js'

/**
 * Experience is settled on the same books as gold.
 *
 * Each of the five hunter skills is an asset of class `SKILL_XP`: zero decimals
 * (XP is indivisible), append-only history, hash-chained entries, idempotent
 * posting — the whole discipline of the money ledger applied to identity.
 * Nothing in the engine knows what "Intelligence" means, which is the point: a
 * skill is a configuration record, exactly like wheat.
 *
 * Two product rules are worth stating where every consumer will read them:
 *
 *   1. **XP is status, gold is money.** There is no conversion path in either
 *      direction, under any name. The ledger enforces the half it can see —
 *      see `assertSameClass`, used by `postTransfer` — and the other half is
 *      the products' to keep: no service may debit XP and credit currency.
 *   2. **XP does not decay by mutation.** If principled decay ever ships it is
 *      posted as explicit negative-amount entries, so the record of what was
 *      earned survives the record of what was lost.
 */
export type SkillKey = 'INTELLIGENCE' | 'STRATEGY' | 'INSTINCT' | 'INFLUENCE' | 'COMMERCE'

export const SKILL_KEYS: readonly SkillKey[] = [
  'INTELLIGENCE',
  'STRATEGY',
  'INSTINCT',
  'INFLUENCE',
  'COMMERCE',
]

/**
 * Asset ids are stable machine names (`xp-int`, …) rather than database ids:
 * they go into every entry hash, so they must mean the same thing in every
 * store the chain ever migrates through. Changing one invalidates history.
 */
const SKILL_META: Record<SkillKey, { assetId: string; slug: string; symbol: string }> = {
  INTELLIGENCE: { assetId: 'xp-int', slug: 'xp-intelligence', symbol: 'INT' },
  STRATEGY:     { assetId: 'xp-str', slug: 'xp-strategy',     symbol: 'STR' },
  INSTINCT:     { assetId: 'xp-ins', slug: 'xp-instinct',     symbol: 'INS' },
  INFLUENCE:    { assetId: 'xp-inf', slug: 'xp-influence',    symbol: 'INF' },
  COMMERCE:     { assetId: 'xp-com', slug: 'xp-commerce',     symbol: 'COM' },
}

export function skillAsset(skill: SkillKey, tenantId: string): Asset {
  const meta = SKILL_META[skill]
  return {
    id: meta.assetId,
    slug: meta.slug,
    symbol: meta.symbol,
    decimals: 0,
    class: 'SKILL_XP',
    tenantId,
  }
}

/** The canonical five skill assets for a tenant's books. */
export function skillAssets(tenantId: string): readonly Asset[] {
  return SKILL_KEYS.map((skill) => skillAsset(skill, tenantId))
}

export function skillAssetRegistry(tenantId: string): ReadonlyMap<string, Asset> {
  return assetRegistry(skillAssets(tenantId))
}

/** Reverse lookup: which skill does an entry's assetId belong to, if any. */
export function skillForAssetId(assetId: string): SkillKey | null {
  for (const skill of SKILL_KEYS) {
    if (SKILL_META[skill].assetId === assetId) return skill
  }
  return null
}

/**
 * The idempotency-key convention for XP earns, in one place so every product in
 * the network derives it identically: `<product>:<activity>:<entityId>:<identityId>`.
 *
 * This is what makes one hunter's XP the same hunter's XP across ClaimYour.Gold,
 * Flashy Academy and whatever ships next. Two products awarding the same lesson
 * must collide on the key rather than both paying — which they only do if they
 * build it the same way, which is why this is a function and not a docs page.
 *
 * Stable by construction. Never a timestamp: a key that differs on every retry
 * is the absence of one wearing the costume of one.
 */
export function xpIdempotencyKey(
  product: string,
  activity: string,
  entityId: string,
  identityId: string,
): string {
  return `${product}:${activity}:${entityId}:${identityId}`
}
