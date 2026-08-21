import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FIELDS,
  GOLD_LEDGER_FIELDS,
  PrecisionError,
  resolveFields,
} from '../src/index.js'
import { readSource, writeSource } from '../src/adapters/field-map.js'

/**
 * Adopting a collection this package did not design.
 *
 * The point of the map is that a network already running a ledger can put this
 * package's rules on top of its existing rows, rather than migrating live money
 * into a new collection. These tests are about the two ways that goes wrong:
 * quietly writing to the wrong key, and quietly converting an amount.
 */

describe('resolving a map', () => {
  it('leaves an unmapped field on this package\'s own name', () => {
    const fields = resolveFields({ identityId: 'customerId' })
    expect(fields.identityId).toBe('customerId')
    expect(fields.tenantId).toBe(DEFAULT_FIELDS.tenantId)
    expect(fields.hash).toBe('hash')
  })

  it('is the default shape when nothing is mapped', () => {
    expect(resolveFields()).toEqual(DEFAULT_FIELDS)
    expect(resolveFields({})).toEqual(DEFAULT_FIELDS)
  })

  it('refuses two fields sharing one key, which is data loss wearing a mapping', () => {
    // The second write overwrites the first and the entry read back is not the
    // entry written — with nothing anywhere reporting a problem.
    expect(() => resolveFields({ identityId: 'assetId' })).toThrow(/more than one field/)
    expect(() => resolveFields({ hash: 'previousHash' })).toThrow(/more than one field/)
  })

  it('counts split source fields in the collision check', () => {
    expect(() =>
      resolveFields({ source: { type: 'kind', id: 'sourceId' } }),
    ).toThrow(/more than one field/)
  })

  it('ignores an explicit undefined rather than mapping a field to nothing', () => {
    const fields = resolveFields({ identityId: undefined })
    expect(fields.identityId).toBe('identityId')
  })

  it('never lets a timestamp order replace _id, only precede it', () => {
    // Two entries in the same millisecond have no order under a timestamp
    // alone, and a chain with no order is not a chain.
    expect(resolveFields({ order: 'createdAt' }).order).toBe('createdAt')
    expect(DEFAULT_FIELDS.order).toBe('_id')
  })
})

describe('the ClaimYour.Gold mapping', () => {
  const fields = resolveFields(GOLD_LEDGER_FIELDS)

  it('names every column that differs from this package\'s own', () => {
    expect(fields.identityId).toBe('customerId')
    expect(fields.kind).toBe('entryType')
    expect(fields.occurredAt).toBe('createdAt')
    expect(fields.order).toBe('createdAt')
    // These already agree, and mapping them would be noise.
    expect(fields.tenantId).toBe('tenantId')
    expect(fields.assetId).toBe('assetId')
    expect(fields.idempotencyKey).toBe('idempotencyKey')
    expect(fields.hash).toBe('hash')
    expect(fields.previousHash).toBe('previousHash')
  })

  it('writes amounts as numbers, because that column already has readers', () => {
    // Writing strings into a numeric column breaks every consumer that has
    // always worked, which is not a migration anyone would call successful.
    expect(fields.amountEncoding).toBe('number')
  })
})

describe('a source split across scalar columns', () => {
  const fields = resolveFields(GOLD_LEDGER_FIELDS)

  it('round-trips through separate fields', () => {
    const doc = writeSource({ type: 'quest', id: 'q_9', description: 'daily' }, fields)
    expect(doc).toEqual({ sourceType: 'quest', sourceId: 'q_9', description: 'daily' })
    expect(readSource(doc, fields)).toEqual({
      type: 'quest',
      id: 'q_9',
      description: 'daily',
    })
  })

  it('writes null rather than omitting, so the column is never absent', () => {
    const doc = writeSource({ type: 'streak' }, fields)
    expect(doc).toEqual({ sourceType: 'streak', sourceId: null, description: null })
    // And reading it back drops the nulls rather than inventing empty strings.
    expect(readSource(doc, fields)).toEqual({ type: 'streak' })
  })

  it('round-trips an embedded source when that is the shape', () => {
    const embedded = resolveFields()
    const doc = writeSource({ type: 'quest', id: 'q_1' }, embedded)
    expect(doc).toEqual({ source: { type: 'quest', id: 'q_1' } })
    expect(readSource(doc, embedded)).toEqual({ type: 'quest', id: 'q_1' })
  })

  it('refuses to stringify a structured value into a source field', () => {
    // String({}) is "[object Object]" — a value that looks like data, indexes,
    // sorts, and means nothing.
    expect(() => readSource({ sourceType: { nested: true } }, fields)).toThrow(
      /no meaningful text form/,
    )
  })
})

describe('the amount guard', () => {
  // decodeAmount is exercised through the adapter in the conformance suite;
  // here the rule itself is pinned, because it is the sequencing constraint for
  // every adoption and the one most likely to be "helpfully" relaxed.
  const decode = async (raw: unknown) => {
    const { MongoLedgerStore } = await import('../src/adapters/mongo.js')
    const docs = [
      {
        _id: 'x',
        tenantId: 'flashy',
        customerId: 'identity_1',
        assetId: 'asset_fg',
        amount: raw,
        balanceBefore: 0,
        balanceAfter: raw,
        entryType: 'EARN',
        sourceType: 'quest',
        sourceId: null,
        description: null,
        idempotencyKey: 'k',
        createdAt: new Date(0),
        previousHash: null,
        hash: 'h',
      },
    ]

    const store = new MongoLedgerStore(
      {
        collection: () => ({
          find: () => ({ sort: () => ({ toArray: async () => docs }) }),
        }),
      } as never,
      { collection: 'gold_ledger', fields: GOLD_LEDGER_FIELDS },
    )

    return store.readEntries({ tenantId: 'flashy', identityId: 'identity_1' })
  }

  it('accepts a whole number of minor units', async () => {
    const [entry] = await decode(125000)
    expect(entry?.amount).toBe(125000)
  })

  it('refuses a decimal, naming the migration rather than converting it', async () => {
    // 12.5 gold is the shape ClaimYour.Gold stores today. Multiplying by 10^4
    // here would be float arithmetic deciding a balance, at the boundary
    // nobody reads.
    await expect(decode(12.5)).rejects.toThrow(PrecisionError)
    await expect(decode(12.5)).rejects.toThrow(/signed integer minor units/)
  })

  it('names the collection and column, so the error says where to look', async () => {
    await expect(decode(0.1)).rejects.toThrow(/gold_ledger\.amount/)
  })

  it('refuses a value that is not a number at all', async () => {
    await expect(decode('not-a-number')).rejects.toThrow(/not a number/)
  })
})
