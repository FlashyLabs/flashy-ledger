/**
 * An asset is a configuration record, not a code path.
 *
 * Adding wheat means adding one of these. Nothing in the engine knows what gold
 * is, which is exactly why it can settle something else.
 */
export interface Asset {
  readonly id: string;
  /** Stable machine name, e.g. 'flashy-gold', 'wheat'. */
  readonly slug: string;
  /** Ticker shown to people, e.g. 'FG', 'WHT'. */
  readonly symbol: string;
  /** How many decimal places this asset settles to. Commodities are usually 0. */
  readonly decimals: number;
  readonly class: AssetClass;
  /** Which network's books this asset belongs to. */
  readonly tenantId: string;
}

export type AssetClass = 'REWARD_CURRENCY' | 'COMMODITY_UNIT' | 'PARTNER_CREDIT' | 'SKILL_XP'

/**
 * Classes whose assets may move between identities.
 *
 * `SKILL_XP` is absent deliberately. Experience is a claim about who earned
 * something; the moment it can be handed to someone else it is a market, and a
 * market in status is a currency by another name. Enforced in `postTransfer`
 * rather than left to each product to remember.
 */
const TRANSFERABLE: ReadonlySet<AssetClass> = new Set<AssetClass>([
  'REWARD_CURRENCY',
  'COMMODITY_UNIT',
  'PARTNER_CREDIT',
])

export function isTransferable(asset: Asset): boolean {
  return TRANSFERABLE.has(asset.class)
};

export function assetRegistry(assets: readonly Asset[]): ReadonlyMap<string, Asset> {
  return new Map(assets.map((a) => [a.id, a]));
}
