import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient } from 'mongodb'
import {
  InMemoryLedgerStore,
  MongoLedgerStore,
  fromDecimal,
  isTransactional,
  post,
  postTransfer,
  type Asset,
  type LedgerStore,
  type ProposedEntry,
  type TransactionalLedgerStore,
} from '../src/index.js'

/**
 * The conformance suite.
 *
 * `LedgerStore` is the seam the whole migration story rests on: a document
 * database implements it today and a chain-backed store may implement it
 * later, and the domain is supposed to be indifferent. "Supposed to be" is not
 * a guarantee — this file is.
 *
 * Every adapter runs the identical suite. An adapter either behaves like the
 * reference implementation or it fails the build, which is what makes swapping
 * storage a configuration change rather than an act of faith.
 *
 * MONGO
 * ─────
 * The Mongo adapter runs when MONGO_URL is set and is skipped otherwise, so a
 * laptop with no database still gets the in-memory pass. CI sets it. Note that
 * multi-entry appends need a replica set for sessions — a standalone mongod
 * passes everything here except the transfer atomicity tests, which is itself
 * the correct behaviour and is asserted below.
 */

const GOLD: Asset = {
  id: 'asset_fg',
  slug: 'flashy-gold',
  symbol: 'FG',
  decimals: 2,
  class: 'REWARD_CURRENCY',
  tenantId: 'flashy',
}

const MONGO_URL = process.env.MONGO_URL

interface Harness {
  name: string
  make: () => Promise<LedgerStore>
  cleanup?: () => Promise<void>
}

/** Build a proposed entry through the domain, so the suite tests real output. */
async function propose(
  store: LedgerStore,
  identityId: string,
  amount: number,
  key: string,
): Promise<ProposedEntry> {
  const state = await store.readState({ tenantId: 'flashy', identityId: identityId, assetId: GOLD.id })
  return post(state, {
    tenantId: 'flashy',
    identityId,
    asset: GOLD,
    amount: fromDecimal(amount, GOLD.decimals),
    kind: amount >= 0 ? 'EARN' : 'SPEND',
    source: { type: 'test', id: key },
    idempotencyKey: key,
    occurredAt: new Date('2026-08-13T12:00:00Z'),
  })
}

/** Same, for a named tenant. Isolation cannot be tested with one tenant. */
async function proposeFor(
  store: LedgerStore,
  tenantId: string,
  identityId: string,
  amount: number,
  key: string,
): Promise<ProposedEntry> {
  const asset: Asset = { ...GOLD, tenantId }
  const state = await store.readState({ tenantId, identityId, assetId: asset.id })
  return post(state, {
    tenantId,
    identityId,
    asset,
    amount: fromDecimal(amount, asset.decimals),
    kind: amount >= 0 ? 'EARN' : 'SPEND',
    source: { type: 'test', id: key },
    idempotencyKey: key,
    occurredAt: new Date('2026-08-13T12:00:00Z'),
  })
}

const harnesses: Harness[] = [
  { name: 'InMemoryLedgerStore', make: async () => new InMemoryLedgerStore() },
]

let client: MongoClient | undefined

if (MONGO_URL) {
  harnesses.push({
    name: 'MongoLedgerStore',
    make: async () => {
      if (!client) {
        client = new MongoClient(MONGO_URL)
        await client.connect()
      }
      const db = client.db(`ledger_conformance_${Date.now()}_${Math.floor(Math.random() * 1e6)}`)
      const store = new MongoLedgerStore(db, { client })
      await store.ensureIndexes()
      return store
    },
  })
}

afterAll(async () => {
  await client?.close()
})

describe.each(harnesses)('$name', ({ make }) => {
  let store: LedgerStore

  beforeAll(async () => {
    store = await make()
  })

  afterEach(async () => {
    // Each test uses a distinct identity, so no teardown is needed and the
    // adapters stay comparable — an adapter that needed cleanup to pass would
    // not be behaving like the reference.
  })

  it('reports an empty state for an identity with no entries', async () => {
    const state = await store.readState({ tenantId: 'flashy', identityId: 'nobody', assetId: GOLD.id })

    expect(state.balance).toBe(0)
    expect(state.headHash).toBeNull()
  })

  it('appends an entry and moves the balance', async () => {
    const id = 'id_append'
    const { entry, deduplicated } = await store.append(await propose(store, id, 25, `${id}:1`))

    expect(deduplicated).toBe(false)
    expect(entry.amount).toBe(2500)
    expect(entry.balanceAfter).toBe(2500)
    expect(entry.id).toBeTruthy()

    const state = await store.readState({ tenantId: 'flashy', identityId: id, assetId: GOLD.id })
    expect(state.balance).toBe(2500)
    expect(state.headHash).toBe(entry.hash)
  })

  it('chains entries so each opens where the last closed', async () => {
    const id = 'id_chain'
    const first = await store.append(await propose(store, id, 10, `${id}:1`))
    const second = await store.append(await propose(store, id, 5, `${id}:2`))

    expect(first.entry.previousHash).toBeNull()
    expect(second.entry.previousHash).toBe(first.entry.hash)
    expect(second.entry.balanceBefore).toBe(first.entry.balanceAfter)
    expect(second.entry.balanceAfter).toBe(1500)
  })

  it('returns the original entry when a key is replayed, and writes nothing', async () => {
    const id = 'id_replay'
    const proposed = await propose(store, id, 40, `${id}:once`)

    const first = await store.append(proposed)
    const again = await store.append(proposed)

    expect(first.deduplicated).toBe(false)
    expect(again.deduplicated).toBe(true)
    expect(again.entry.id).toBe(first.entry.id)

    // The balance moved once, not twice. This is the property the whole
    // idempotency design exists for.
    const state = await store.readState({ tenantId: 'flashy', identityId: id, assetId: GOLD.id })
    expect(state.balance).toBe(4000)
    expect(await store.readEntries({ tenantId: 'flashy', identityId: id, assetId: GOLD.id })).toHaveLength(1)
  })

  it('finds an entry by its idempotency key, and nothing by an unused one', async () => {
    const id = 'id_lookup'
    const { entry } = await store.append(await propose(store, id, 7, `${id}:k`))

    expect((await store.findByIdempotencyKey('flashy', `${id}:k`))?.id).toBe(entry.id)
    expect(await store.findByIdempotencyKey('flashy', `${id}:never`)).toBeNull()
  })

  it('reads a chain back in the order it was written', async () => {
    const id = 'id_order'
    for (let n = 1; n <= 4; n++) {
      await store.append(await propose(store, id, n, `${id}:${n}`))
    }

    const entries = await store.readEntries({ tenantId: 'flashy', identityId: id, assetId: GOLD.id })
    expect(entries.map((e) => e.amount)).toEqual([100, 200, 300, 400])
  })

  it('keeps identities separate', async () => {
    await store.append(await propose(store, 'id_a', 10, 'id_a:1'))
    await store.append(await propose(store, 'id_b', 99, 'id_b:1'))

    expect((await store.readState({ tenantId: 'flashy', identityId: 'id_a', assetId: GOLD.id })).balance).toBe(1000)
    expect((await store.readState({ tenantId: 'flashy', identityId: 'id_b', assetId: GOLD.id })).balance).toBe(9900)
    expect(await store.readEntries({ tenantId: 'flashy', identityId: 'id_a', assetId: GOLD.id })).toHaveLength(1)
  })

  it('declares whether it can commit several entries together', () => {
    // Not every store can, which is why this is a capability check rather than
    // an assumption. A caller that needs transfers has to ask.
    expect(isTransactional(store)).toBe(true)
  })
})

describe.each(harnesses)('$name — transfers', ({ make }) => {
  let store: TransactionalLedgerStore

  beforeAll(async () => {
    const made = await make()
    if (!isTransactional(made)) throw new Error('store is not transactional')
    store = made
  })

  it('lands a debit and its matching credit together', async () => {
    const senderState = await store.readState({ tenantId: 'flashy', identityId: 'id_sender', assetId: GOLD.id })
    await store.append(
      post(senderState, {
        tenantId: 'flashy',
        identityId: 'id_sender',
        asset: GOLD,
        amount: fromDecimal(100, GOLD.decimals),
        kind: 'EARN',
        source: { type: 'test' },
        idempotencyKey: 'fund_sender',
        occurredAt: new Date('2026-08-13T12:00:00Z'),
      }),
    )

    const [from, to] = await Promise.all([
      store.readState({ tenantId: 'flashy', identityId: 'id_sender', assetId: GOLD.id }),
      store.readState({ tenantId: 'flashy', identityId: 'id_recipient', assetId: GOLD.id }),
    ])

    const pair = postTransfer(
      { state: from, identityId: 'id_sender' },
      { state: to, identityId: 'id_recipient' },
      {
        tenantId: 'flashy',
        asset: GOLD,
        amount: fromDecimal(30, GOLD.decimals),
        source: { type: 'test', id: 'xfer' },
        idempotencyKey: 'xfer_1',
        occurredAt: new Date('2026-08-13T12:00:00Z'),
      },
    )

    const results = await store.appendAll(pair)
    expect(results).toHaveLength(2)
    expect(results.every((r) => !r.deduplicated)).toBe(true)

    expect((await store.readState({ tenantId: 'flashy', identityId: 'id_sender', assetId: GOLD.id })).balance).toBe(7000)
    expect((await store.readState({ tenantId: 'flashy', identityId: 'id_recipient', assetId: GOLD.id })).balance).toBe(3000)
  })

  it('treats an empty batch as a no-op rather than an error', async () => {
    expect(await store.appendAll([])).toEqual([])
  })
})

/**
 * Tenant isolation.
 *
 * These run against every adapter, because isolation is a property of the port
 * rather than of any one implementation — an in-memory reference that isolates
 * while the database adapter does not would be worse than neither doing it,
 * since the suite would report a guarantee production does not have.
 *
 * Every case here fails against the pre-0.2 adapters, where `tenantId` was
 * written onto every entry and used in no query, no index and no signature.
 */
describe.each(harnesses)('$name — tenant isolation', ({ make }) => {
  let store: LedgerStore

  beforeEach(async () => {
    store = await make()
  })

  it('lets two tenants use the same idempotency key without deduplicating', async () => {
    // The failure this prevents: keys are derived from source events — this
    // package's own example is `quest:q_9:identity_1` — so two networks running
    // similar mechanics collide by construction. Globally scoped, tenant B's
    // legitimate award silently returns tenant A's entry and reports success.
    const key = 'quest:q_9:identity_1'

    const a = await store.append(await proposeFor(store, 'flashy', 'identity_1', 10, key))
    const b = await store.append(await proposeFor(store, 'acme', 'identity_1', 25, key))

    expect(a.deduplicated).toBe(false)
    expect(b.deduplicated).toBe(false)
    expect(b.entry.id).not.toBe(a.entry.id)
    expect(b.entry.amount).toBe(2500)
    expect(a.entry.amount).toBe(1000)
  })

  it('gives each tenant its own chain head for the same identity and asset', async () => {
    // Both first entries carry previousHash null. Under a chain-head index that
    // is not tenant-scoped, the second is rejected as a duplicate — a correct
    // write refused because an unrelated network got there first.
    await store.append(await proposeFor(store, 'flashy', 'shared_identity', 10, 'k_flashy'))
    await store.append(await proposeFor(store, 'acme', 'shared_identity', 10, 'k_acme'))

    const flashy = await store.readEntries({ tenantId: 'flashy', identityId: 'shared_identity' })
    const acme = await store.readEntries({ tenantId: 'acme', identityId: 'shared_identity' })

    expect(flashy).toHaveLength(1)
    expect(acme).toHaveLength(1)
    expect(flashy[0]?.previousHash).toBeNull()
    expect(acme[0]?.previousHash).toBeNull()
  })

  it('scopes readState, so a balance is never a sum of two tenants books', async () => {
    await store.append(await proposeFor(store, 'flashy', 'identity_1', 10, 'k1'))
    await store.append(await proposeFor(store, 'acme', 'identity_1', 25, 'k2'))

    const flashy = await store.readState({
      tenantId: 'flashy',
      identityId: 'identity_1',
      assetId: GOLD.id,
    })
    const acme = await store.readState({
      tenantId: 'acme',
      identityId: 'identity_1',
      assetId: GOLD.id,
    })

    expect(flashy.balance).toBe(1000)
    expect(acme.balance).toBe(2500)
  })

  it('scopes readEntries', async () => {
    await store.append(await proposeFor(store, 'flashy', 'identity_1', 10, 'k1'))
    await store.append(await proposeFor(store, 'acme', 'identity_1', 25, 'k2'))

    const entries = await store.readEntries({
      tenantId: 'flashy',
      identityId: 'identity_1',
      assetId: GOLD.id,
    })

    expect(entries).toHaveLength(1)
    expect(entries.every((e) => e.tenantId === 'flashy')).toBe(true)
  })

  it('scopes findByIdempotencyKey, so a lookup never returns another tenants entry', async () => {
    await store.append(await proposeFor(store, 'flashy', 'identity_1', 10, 'shared_key'))

    expect(await store.findByIdempotencyKey('acme', 'shared_key')).toBeNull()
    expect((await store.findByIdempotencyKey('flashy', 'shared_key'))?.tenantId).toBe('flashy')
  })

  it('still deduplicates a genuine replay within one tenant', async () => {
    // The isolation must not have been bought by weakening idempotency.
    const first = await store.append(await proposeFor(store, 'acme', 'identity_1', 10, 'replay'))
    const second = await store.append(await proposeFor(store, 'acme', 'identity_1', 10, 'replay'))

    expect(second.deduplicated).toBe(true)
    expect(second.entry.id).toBe(first.entry.id)
  })
})
