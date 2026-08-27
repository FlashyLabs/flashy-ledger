import { describe, expect, it } from 'vitest'
import {
  FLASHY_ASSET_DEFINITIONS,
  FLASHY_GOLD,
  FLASHY_WORK_UNIT,
  SKILL_KEYS,
  assetDefinition,
  defineAsset,
  isTransferable,
  flashyAssets,
  materialize,
  type AssetDefinition,
  CIVILIZATION_COMMODITIES,
} from '../src/index.js'

/**
 * The registry's contract.
 *
 * These tests pin the numbers that convert between what a person reads and
 * what the ledger stores. A wrong one here does not throw anywhere — it
 * produces balances that are wrong by a power of ten and look entirely
 * ordinary, which is what happened when flashynetwork.com published
 * `decimals: 4` for an asset the engine settles at 2.
 */

const TENANT = 'flashy'

describe('Flashy Gold', () => {
  it('settles at two decimal places — the number that was published as four', () => {
    // If this test ever needs changing, the change is a migration of every
    // entry ever written, not an edit to a line.
    expect(FLASHY_GOLD.decimals).toBe(2)
  })

  it('pins the identity every published surface repeats', () => {
    expect(FLASHY_GOLD).toMatchObject({
      slug: 'flashy-gold',
      symbol: 'FG',
      name: 'Flashy Gold',
      class: 'REWARD_CURRENCY',
    })
  })

  it('is frozen, so no consumer can localise the economy by mutating it', () => {
    expect(Object.isFrozen(FLASHY_GOLD)).toBe(true)
  })
})

describe('Flashy Work Unit', () => {
  it('is an indivisible commodity unit, never a currency', () => {
    expect(FLASHY_WORK_UNIT.decimals).toBe(0)
    expect(FLASHY_WORK_UNIT.class).toBe('COMMODITY_UNIT')
    expect(FLASHY_WORK_UNIT.symbol).toBe('FWU')
  })
})

describe('the registry as a whole', () => {
  it('has unique slugs and unique symbols', () => {
    // Two assets sharing a slug is a lookup that silently returns the wrong
    // asset, and therefore the wrong decimals.
    const slugs = FLASHY_ASSET_DEFINITIONS.map((a) => a.slug)
    const symbols = FLASHY_ASSET_DEFINITIONS.map((a) => a.symbol)
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(new Set(symbols).size).toBe(symbols.length)
  })

  it('gives every asset a description, because the asset page publishes one', () => {
    for (const asset of FLASHY_ASSET_DEFINITIONS) {
      expect(asset.description.length, `${asset.slug} needs a description`).toBeGreaterThan(20)
    }
  })

  it('looks up by slug and reports an unknown one as absent rather than throwing', () => {
    expect(assetDefinition('flashy-gold')).toBe(FLASHY_GOLD)
    // Not 'wheat' — that is a declared commodity now. An absence test whose
    // subject quietly becomes real stops testing absence.
    expect(assetDefinition('unobtainium')).toBeNull()
  })

  it('excludes skill XP — status is not a holding, and listing it invites the conversion question', () => {
    const slugs = FLASHY_ASSET_DEFINITIONS.map((a) => a.slug)
    expect(slugs.some((s) => s.startsWith('xp-'))).toBe(false)
  })
})

describe('defineAsset — minting a new asset is one declaration', () => {
  // Deliberately not one of the declared assets: this block is about the
  // minting procedure, and a fixture that shadows a real declaration makes a
  // failure here read as a problem with that asset.
  const barley: AssetDefinition = {
    slug: 'barley',
    symbol: 'BRL',
    name: 'Barley',
    decimals: 0,
    class: 'COMMODITY_UNIT',
    description: 'A bushel of barley, settled on the same books as everything else.',
  }

  it('accepts a well-formed definition — this is the whole procedure for a new asset', () => {
    const asset = defineAsset(barley)
    expect(asset.slug).toBe('barley')
    expect(Object.isFrozen(asset)).toBe(true)
  })

  it('rejects a slug that is not lower-case kebab, because slugs reach URLs and machine surfaces', () => {
    expect(() => defineAsset({ ...barley, slug: 'Wheat Futures' })).toThrow(/kebab/)
    expect(() => defineAsset({ ...barley, slug: 'wheat_futures' })).toThrow(/kebab/)
    expect(() => defineAsset({ ...barley, slug: '-wheat' })).toThrow(/kebab/)
  })

  it('rejects a malformed symbol', () => {
    expect(() => defineAsset({ ...barley, symbol: 'w' })).toThrow(/symbol/)
    expect(() => defineAsset({ ...barley, symbol: 'TOOMANYCHARS' })).toThrow(/symbol/)
  })

  it('rejects decimals that are negative, fractional, or beyond what minor units carry', () => {
    expect(() => defineAsset({ ...barley, decimals: -1 })).toThrow(/decimals/)
    expect(() => defineAsset({ ...barley, decimals: 2.5 })).toThrow(/decimals/)
    expect(() => defineAsset({ ...barley, decimals: 9 })).toThrow(/decimals/)
  })

  it('insists on a name and a description', () => {
    expect(() => defineAsset({ ...barley, name: '  ' })).toThrow(/display name/)
    expect(() => defineAsset({ ...barley, description: '' })).toThrow(/description/)
  })
})

describe('materialize', () => {
  it('supplies the two things that depend on where the asset lives', () => {
    const asset = materialize(FLASHY_GOLD, { id: '507f1f77bcf86cd799439011', tenantId: TENANT })
    expect(asset).toEqual({
      id: '507f1f77bcf86cd799439011',
      slug: 'flashy-gold',
      symbol: 'FG',
      decimals: 2,
      class: 'REWARD_CURRENCY',
      tenantId: TENANT,
    })
  })

  it('refuses an empty id — entries keyed on one cannot be read back, and it fails silently', () => {
    expect(() => materialize(FLASHY_GOLD, { id: '', tenantId: TENANT })).toThrow(/no id supplied/i)
  })

  it('carries no description into the store — that is published, not settled', () => {
    const asset = materialize(FLASHY_GOLD, { id: 'a1', tenantId: TENANT })
    expect(asset).not.toHaveProperty('description')
    expect(asset).not.toHaveProperty('name')
  })
})

describe('flashyAssets', () => {
  it('returns the provisioned economy assets plus all five skills', () => {
    const assets = flashyAssets(TENANT, { 'flashy-gold': 'fg-id', 'flashy-work-unit': 'fwu-id' })
    expect(assets).toHaveLength(2 + SKILL_KEYS.length)
    expect(assets.find((a) => a.slug === 'flashy-gold')?.id).toBe('fg-id')
    expect(assets.every((a) => a.tenantId === TENANT)).toBe(true)
  })

  it('omits an asset this environment has not provisioned rather than inventing an id', () => {
    // Absent is a true statement about a staging environment that has no FWU
    // row. A fabricated id is not, and it writes unreadable entries.
    const assets = flashyAssets(TENANT, { 'flashy-gold': 'fg-id' })
    expect(assets.some((a) => a.slug === 'flashy-work-unit')).toBe(false)
    expect(assets.some((a) => a.slug === 'flashy-gold')).toBe(true)
  })

  it('gives skill assets their frozen ids without needing the environment to supply any', () => {
    const assets = flashyAssets(TENANT, {})
    expect(assets.map((a) => a.id)).toContain('xp-int')
    expect(assets).toHaveLength(SKILL_KEYS.length)
  })
})

describe('the civilization commodities', () => {
  it('declares four, all indivisible', () => {
    expect(CIVILIZATION_COMMODITIES).toHaveLength(4)
    for (const asset of CIVILIZATION_COMMODITIES) {
      // Not a display preference: amounts are hashed as minor units, so a
      // decimals disagreement reinterprets every historical entry.
      expect(asset.decimals).toBe(0)
    }
  })

  it('classes every one as a commodity, never a currency', () => {
    for (const asset of CIVILIZATION_COMMODITIES) {
      expect(asset.class).toBe('COMMODITY_UNIT')
    }
  })

  it('pins the slugs, because they resolve to ids that enter every hash', () => {
    expect(CIVILIZATION_COMMODITIES.map((a) => a.slug)).toEqual(['wheat', 'wood', 'stone', 'iron'])
  })

  it('gives each a distinct symbol', () => {
    const symbols = CIVILIZATION_COMMODITIES.map((a) => a.symbol)
    expect(new Set(symbols).size).toBe(symbols.length)
  })

  it('lists them among the assets the economy settles', () => {
    for (const asset of CIVILIZATION_COMMODITIES) {
      expect(assetDefinition(asset.slug)).toEqual(asset)
    }
  })

  it('keeps them transferable — raids and a marketplace need them to move', () => {
    for (const definition of CIVILIZATION_COMMODITIES) {
      expect(isTransferable(materialize(definition, { id: `id_${definition.slug}`, tenantId: 'flashy' }))).toBe(true)
    }
  })
})

