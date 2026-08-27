import type { Asset, AssetClass } from './asset.js'
import { SKILL_KEYS, skillAsset } from './experience.js'

/**
 * The Flashy economy's assets, declared once.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Flashy Gold was declared independently in four places: this package's
 * examples, flashy-gold's `lib/ledger.ts`, flashynetwork.com's `lib/ledger.ts`
 * and a row in ClaimYour.Gold's `assets` collection. Three said `decimals: 2`.
 * One said `decimals: 4`, and it was the one published on the settlement
 * record — so an integrator following the public asset registry rendered every
 * balance a hundred times wrong, and nothing in any repository disagreed with
 * them loudly enough to notice.
 *
 * That class of bug is not fixed by correcting the four. It is fixed by there
 * being one, which is this file.
 *
 * DEFINITION vs ASSET
 * ───────────────────
 * An `AssetDefinition` is the part that is true everywhere and forever: slug,
 * symbol, name, decimals, class. It is what the public record publishes and
 * what an integrator codes against.
 *
 * An `Asset` additionally carries `id` and `tenantId`, and those are
 * deliberately NOT in the definition. In production the id is the ObjectId of
 * a row in ClaimYour.Gold's `assets` collection — it differs between
 * environments, entries are keyed on it, and putting a slug in that field is
 * the exact bug that once made four payouts fail silently with no type error
 * to catch it. So the id is supplied at the edge, by `materialize`, from
 * whatever the environment says it is.
 *
 * MINTING A NEW ASSET
 * ───────────────────
 * Add one entry to `FLASHY_ASSET_DEFINITIONS`. That is the whole procedure.
 * `defineAsset` validates the shape, the registry tests enforce that slugs and
 * symbols stay unique, and nothing in the engine needs to learn what the new
 * thing is — an asset is a configuration record, not a code path.
 */

/**
 * The immutable public identity of an asset. No id, no tenant: those describe
 * where a copy of it lives, not what it is.
 */
export interface AssetDefinition {
  /** Stable machine name. Kebab-case, and part of every published surface. */
  readonly slug: string
  /** Ticker shown to people. */
  readonly symbol: string
  /** Display name. */
  readonly name: string
  /**
   * How many decimal places this asset settles to.
   *
   * This is the single most dangerous number in the package. It converts
   * between what a person reads and what the ledger stores, so a definition
   * that disagrees with the engine does not fail — it produces answers that
   * are wrong by a power of ten and look completely ordinary.
   */
  readonly decimals: number
  readonly class: AssetClass
  /** One line, for the public asset page. */
  readonly description: string
}

const SLUG_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9]{1,7}$/
/** Beyond this, minor units stop fitting comfortably in the places they travel. */
const MAX_DECIMALS = 8

/**
 * Declare an asset.
 *
 * Validates at module load, so a malformed definition is a startup failure in
 * every consumer at once rather than a wrong number in one of them later.
 */
export function defineAsset(definition: AssetDefinition): AssetDefinition {
  const { slug, symbol, decimals } = definition

  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `Asset slug "${slug}" must be lower-case kebab: it appears in URLs, machine surfaces and every published registry.`,
    )
  }
  if (!SYMBOL_PATTERN.test(symbol)) {
    throw new Error(`Asset symbol "${symbol}" must be 2-8 upper-case alphanumerics, e.g. "FG".`)
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new Error(
      `Asset "${slug}" has decimals ${decimals}; must be an integer between 0 and ${MAX_DECIMALS}.`,
    )
  }
  if (!definition.name.trim()) {
    throw new Error(`Asset "${slug}" needs a display name.`)
  }
  if (!definition.description.trim()) {
    throw new Error(
      `Asset "${slug}" needs a one-line description — it is published on the asset page, and an asset nobody can describe is one nobody should be settling.`,
    )
  }

  return Object.freeze({ ...definition })
}

/**
 * Flashy Gold.
 *
 * `decimals: 2`. This is the number flashynetwork.com published as 4. Anything
 * that disagrees with this line is wrong, including a database row.
 */
export const FLASHY_GOLD = defineAsset({
  slug: 'flashy-gold',
  symbol: 'FG',
  name: 'Flashy Gold',
  decimals: 2,
  class: 'REWARD_CURRENCY',
  description:
    'The rewards currency of the Flashy economy, earned through verified action and redeemable inside it.',
})

/**
 * The Flashy Work Unit — one unit of settled, verified cross-org work.
 *
 * Zero decimals: a unit of work is indivisible. Deliberately a COMMODITY_UNIT
 * rather than a currency, and there is no conversion path to gold in either
 * direction under any name.
 */
export const FLASHY_WORK_UNIT = defineAsset({
  slug: 'flashy-work-unit',
  symbol: 'FWU',
  name: 'Flashy Work Unit',
  decimals: 0,
  class: 'COMMODITY_UNIT',
  description:
    'One unit of settled, verified joint work between organizations on the FlashyOS mesh. Not a currency and not convertible to one.',
})

/**
 * The four civilization commodities.
 *
 * Zero decimals, all of them: a third of a stone is not a thing anyone mined.
 * That is not a display preference — the amounts are hashed as minor units, so
 * a decimals disagreement silently reinterprets every historical entry, which
 * is the failure this registry exists to prevent.
 *
 * `COMMODITY_UNIT` and never anything else. They buy buildings, upgrades and
 * marketplace goods; there is no path from any of them to Flashy Gold under
 * any name. Gold may buy commodities — that direction is a sink for a currency
 * people can redeem, and it is the only direction that exists.
 */
export const WHEAT = defineAsset({
  slug: 'wheat',
  symbol: 'WHT',
  name: 'Wheat',
  decimals: 0,
  class: 'COMMODITY_UNIT',
  description: 'A civilization resource. Feeds buildings and armies; produced by farmhouses.',
})

export const WOOD = defineAsset({
  slug: 'wood',
  symbol: 'WOD',
  name: 'Wood',
  decimals: 0,
  class: 'COMMODITY_UNIT',
  description: 'A civilization resource. The primary construction material; produced by lumber camps.',
})

export const STONE = defineAsset({
  slug: 'stone',
  symbol: 'STN',
  name: 'Stone',
  decimals: 0,
  class: 'COMMODITY_UNIT',
  description: 'A civilization resource. Fortification and heavy construction; produced by quarries.',
})

export const IRON = defineAsset({
  slug: 'iron',
  symbol: 'IRN',
  name: 'Iron',
  decimals: 0,
  class: 'COMMODITY_UNIT',
  description: 'A civilization resource. Weapons, armour and advanced construction; produced by forges.',
})

/** The civilization commodities, in the order a hunter unlocks them. */
export const CIVILIZATION_COMMODITIES: readonly AssetDefinition[] = Object.freeze([
  WHEAT,
  WOOD,
  STONE,
  IRON,
])

/**
 * Every asset the Flashy economy settles, excluding skill XP.
 *
 * XP is kept out of this list on purpose. The five skills are assets to the
 * engine and are registered through `skillAssets`, but they are status rather
 * than holdings — listing them beside gold on an asset page would invite
 * exactly the conversion question the design refuses to answer.
 */
export const FLASHY_ASSET_DEFINITIONS: readonly AssetDefinition[] = Object.freeze([
  FLASHY_GOLD,
  FLASHY_WORK_UNIT,
  ...CIVILIZATION_COMMODITIES,
])

/** Look a definition up by its slug. Null rather than throw: callers publish absences. */
export function assetDefinition(slug: string): AssetDefinition | null {
  return FLASHY_ASSET_DEFINITIONS.find((a) => a.slug === slug) ?? null
}

/**
 * Turn a definition into a store-ready `Asset` by supplying the two things
 * that depend on where it lives.
 *
 * `id` is required and has no default, because the failure it prevents is
 * silent: a slug in that field writes an entry nothing can ever read back.
 */
export function materialize(
  definition: AssetDefinition,
  where: { id: string; tenantId: string },
): Asset {
  if (!where.id) {
    throw new Error(
      `No id supplied for asset "${definition.slug}". Entries are keyed on the id, so an empty or slug-valued id writes entries that cannot be read back — and does it without a type error.`,
    )
  }
  return {
    id: where.id,
    slug: definition.slug,
    symbol: definition.symbol,
    decimals: definition.decimals,
    class: definition.class,
    tenantId: where.tenantId,
  }
}

/**
 * Every asset on a tenant's books, materialized — the two economy assets plus
 * the five skills.
 *
 * `ids` maps slug to the id that tenant's store uses. A slug with no id is
 * omitted rather than guessed: an asset this environment has not provisioned
 * is absent, which is a true statement, where a fabricated id would not be.
 */
export function flashyAssets(
  tenantId: string,
  ids: Readonly<Record<string, string>>,
): readonly Asset[] {
  const economy = FLASHY_ASSET_DEFINITIONS.flatMap((definition) => {
    const id = ids[definition.slug]
    return id ? [materialize(definition, { id, tenantId })] : []
  })
  // Skill assets carry their own frozen ids — they are part of the hash format
  // and never environment-specific, so they need nothing from `ids`.
  const skills = SKILL_KEYS.map((key) => skillAsset(key, tenantId))
  return [...economy, ...skills]
}
