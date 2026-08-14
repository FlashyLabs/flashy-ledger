import { describe, expect, it } from 'vitest'
import type { Db } from 'mongodb'
import { GoldLedgerReader, hashEntry, isChained, minor, verifyEntry } from '../src/index.js'

/**
 * The conversion is the whole risk in this adapter.
 *
 * ClaimYour.Gold stores gold as a floating-point number of major units. This
 * package works in integer minor units. Everything else here is a query; the
 * arithmetic at that boundary is where money can quietly disappear, so it is
 * tested against a fake collection rather than left to a database that is not
 * available at build time.
 */

interface FakeDoc {
  _id: string
  publicId: string
  tenantId: string
  customerId: string
  assetId: string
  entryType: string
  amount: number
  balanceBefore: number
  balanceAfter: number
  sourceType: string
  sourceId?: string | null
  idempotencyKey: string
  description?: string | null
  metadata?: Record<string, unknown> | null
  createdAt: Date
  previousHash?: string | null
  hash?: string | null
}

/** Enough of the driver's surface for the reader, and no more. */
function fakeDb(entries: FakeDoc[], wallets: { customerId: string; goldBalance: number }[] = []): Db {
  const cursor = (rows: unknown[]) => ({
    sort: () => cursor(rows),
    limit: (n: number) => cursor(rows.slice(0, n)),
    toArray: async () => rows,
  })

  return {
    collection: (name: string) => {
      if (name === 'wallets') {
        return {
          findOne: async (f: { customerId: string }) =>
            wallets.find((w) => w.customerId === f.customerId) ?? null,
        }
      }
      return {
        findOne: async (f: Record<string, unknown>, opts?: { sort?: Record<string, number> }) => {
          const matched = entries.filter((e) =>
            Object.entries(f).every(([k, v]) => (e as never)[k] === v),
          )
          if (matched.length === 0) return null
          // Mirror the driver: a descending sort means the caller wants the
          // newest, which for these tests is the last one inserted.
          const desc = opts?.sort ? Object.values(opts.sort)[0] === -1 : false
          return desc ? matched[matched.length - 1] : matched[0]
        },
        find: (f: Record<string, unknown>) =>
          cursor(entries.filter((e) => Object.entries(f).every(([k, v]) => (e as never)[k] === v))),
      }
    },
  } as unknown as Db
}

function doc(over: Partial<FakeDoc> = {}): FakeDoc {
  return {
    _id: 'e1',
    publicId: 'pub-1',
    tenantId: 'flashy',
    customerId: 'cust1',
    assetId: 'asset_fg',
    entryType: 'EARN_QUEST',
    amount: 10,
    balanceBefore: 0,
    balanceAfter: 10,
    sourceType: 'quest',
    idempotencyKey: 'k1',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    ...over,
  }
}

/**
 * First element, or a failure that names the reason.
 *
 * `noUncheckedIndexedAccess` types every index access as possibly undefined,
 * which is correct — and destructuring in a test hides that behind an
 * assertion failure on a property of undefined. This turns it into a message
 * that says what actually went wrong.
 */
function only<T>(items: readonly T[]): T {
  if (items.length !== 1) throw new Error(`expected exactly one entry, got ${items.length}`)
  return items[0] as T
}

describe('GoldLedgerReader', () => {
  it('reports an empty state for an identity with no entries', async () => {
    const r = new GoldLedgerReader(fakeDb([]))
    expect(await r.readState('nobody', 'asset_fg')).toEqual({ balance: 0, headHash: null })
  })

  it('converts major units to minor units', async () => {
    const r = new GoldLedgerReader(fakeDb([doc({ amount: 12.34, balanceAfter: 12.34 })]))
    const state = await r.readState('cust1', 'asset_fg')
    expect(state.balance).toBe(1234)
  })

  it('rounds a float that reads back imprecisely, rather than truncating it', async () => {
    // 12.34 written to a float column can read back as 12.339999999999998.
    // Truncating loses a whole minor unit per entry, always downward.
    const r = new GoldLedgerReader(fakeDb([doc({ balanceAfter: 12.339999999999998 })]))
    expect((await r.readState('cust1', 'asset_fg')).balance).toBe(1234)
  })

  it('honours a non-default decimal scale', async () => {
    const r = new GoldLedgerReader(fakeDb([doc({ balanceAfter: 12.3 })]), { decimals: 3 })
    expect((await r.readState('cust1', 'asset_fg')).balance).toBe(12300)
  })

  it('reports no chain head when the newest entry predates the cutover', async () => {
    // Inventing one would look like tamper-evidence to every caller while
    // proving nothing at all.
    const r = new GoldLedgerReader(fakeDb([doc()]))
    expect((await r.readState('cust1', 'asset_fg')).headHash).toBeNull()
  })

  it('reports the real chain head once one has been written', async () => {
    // The opposite error to inventing a hash, and the more dangerous of the
    // two: a caller that posts from a null head starts a second chain beside
    // the live one, and nothing notices until someone verifies.
    const r = new GoldLedgerReader(fakeDb([doc({ hash: 'abc123', previousHash: null })]))
    expect((await r.readState('cust1', 'asset_fg')).headHash).toBe('abc123')
  })

  it('classifies by sign, and keeps the original entry type', async () => {
    const r = new GoldLedgerReader(
      fakeDb([doc({ amount: -5, entryType: 'SPEND_WAGER', balanceAfter: 5 })]),
    )
    const entry = only(await r.readEntries('cust1', 'asset_fg'))

    expect(entry.kind).toBe('SPEND')
    expect(entry.amount).toBe(-500)
    // The stored enum is richer than EARN/SPEND, so it survives translation
    // rather than being flattened away.
    expect(entry.metadata?.goldLedgerEntryType).toBe('SPEND_WAGER')
  })

  it('carries the source through as type and id', async () => {
    const r = new GoldLedgerReader(fakeDb([doc({ sourceType: 'duel', sourceId: 'd7' })]))
    const entry = only(await r.readEntries('cust1', 'asset_fg'))
    expect(entry.source).toEqual({ type: 'duel', id: 'd7' })
  })

  it('omits the source id when there is none', async () => {
    const r = new GoldLedgerReader(fakeDb([doc({ sourceId: null })]))
    const entry = only(await r.readEntries('cust1', 'asset_fg'))
    expect(entry.source).toEqual({ type: 'quest' })
  })

  it('finds an entry by idempotency key, and nothing by an unused one', async () => {
    const r = new GoldLedgerReader(fakeDb([doc({ idempotencyKey: 'quest:7' })]))
    expect((await r.findByIdempotencyKey('quest:7'))?.idempotencyKey).toBe('quest:7')
    expect(await r.findByIdempotencyKey('never')).toBeNull()
  })

  it('caps how many recent entries it will return', async () => {
    const many = Array.from({ length: 300 }, (_, i) => doc({ _id: `e${i}`, idempotencyKey: `k${i}` }))
    const r = new GoldLedgerReader(fakeDb(many))
    // A long-lived hunter has thousands of entries and no endpoint should
    // serialise all of them to answer "what happened lately?".
    expect(await r.readRecentEntries('cust1', 'asset_fg', 1000)).toHaveLength(200)
    expect(await r.readRecentEntries('cust1', 'asset_fg', 10)).toHaveLength(10)
  })

  it('confirms the wallet cache agrees with the ledger', async () => {
    const r = new GoldLedgerReader(
      fakeDb([doc({ balanceAfter: 42 })], [{ customerId: 'cust1', goldBalance: 42 }]),
    )
    expect(await r.verifyBalance('cust1', 'asset_fg')).toEqual({ ok: true, wallet: 4200, ledger: 4200 })
  })

  it('reports drift when the wallet cache disagrees with the ledger', async () => {
    // This is the question that has never been answered against production
    // data — the wallet is a cached fold, and it is the cache that drifts.
    const r = new GoldLedgerReader(
      fakeDb([doc({ balanceAfter: 42 })], [{ customerId: 'cust1', goldBalance: 7 }]),
    )
    const result = await r.verifyBalance('cust1', 'asset_fg')
    expect(result.ok).toBe(false)
    expect(result.wallet).toBe(700)
    expect(result.ledger).toBe(4200)
  })

  it('treats a missing wallet as a zero balance', async () => {
    const r = new GoldLedgerReader(fakeDb([doc({ balanceAfter: 5 })], []))
    expect(await r.verifyBalance('cust1', 'asset_fg')).toEqual({ ok: false, wallet: 0, ledger: 500 })
  })
})

/**
 * The chain-forward contract, from the reading side.
 *
 * ClaimYour.Gold's `postEntry` writes the hash; this package defines what the
 * hash is over. Those are two repositories, and the only thing keeping them
 * agreeing is that both call `hashEntry` with the same fields in the same
 * units. `chained()` below constructs a row exactly as `postEntry` does — minor
 * units into the digest, major units into the columns, `createdAt` set to the
 * instant that was hashed rather than left to the database clock — so if either
 * side of that contract moves, these fail rather than production doing so
 * quietly on the next audit.
 */
function chained(
  over: Partial<FakeDoc> & { amount: number; balanceBefore: number; balanceAfter: number },
  previousHash: string | null,
): FakeDoc {
  const base = doc(over)
  const scale = 100
  const toMinor = (major: number) => minor(Math.round(major * scale))

  const hash = hashEntry({
    previousHash,
    tenantId: base.tenantId,
    identityId: base.customerId,
    assetId: base.assetId,
    amount: toMinor(base.amount),
    balanceBefore: toMinor(base.balanceBefore),
    balanceAfter: toMinor(base.balanceAfter),
    kind: base.amount >= 0 ? 'EARN' : 'SPEND',
    source: { type: base.sourceType, ...(base.sourceId ? { id: base.sourceId } : {}) },
    idempotencyKey: base.idempotencyKey,
    occurredAt: base.createdAt,
  })

  return { ...base, previousHash, hash }
}

describe('GoldLedgerReader, on a chain-forward ledger', () => {
  const first = chained(
    { _id: 'c1', idempotencyKey: 'k-c1', amount: 10, balanceBefore: 0, balanceAfter: 10 },
    null,
  )
  const second = chained(
    {
      _id: 'c2',
      idempotencyKey: 'k-c2',
      amount: -2.5,
      balanceBefore: 10,
      balanceAfter: 7.5,
      sourceType: 'duel',
      sourceId: 'd7',
      createdAt: new Date('2026-08-02T00:00:00Z'),
    },
    first.hash as string,
  )

  it('reads back an entry that still verifies against its own hash', async () => {
    // The cross-repo contract in one assertion: a row written the way
    // postEntry writes it, read back through this adapter, recomputes to the
    // same digest. If the field order, the units, or the timestamp source
    // drifts on either side, this is what fails.
    const r = new GoldLedgerReader(fakeDb([first]))
    const entry = only(await r.readEntries('cust1', 'asset_fg'))
    expect(verifyEntry(entry)).toBe(true)
  })

  it('distinguishes chained rows from the years of unchained ones', async () => {
    const r = new GoldLedgerReader(fakeDb([doc({ _id: 'old', idempotencyKey: 'k-old' }), first]))
    const entries = await r.readEntries('cust1', 'asset_fg')
    expect(entries.map(isChained)).toEqual([false, true])
  })

  it('verifies the chained suffix and says how much of the history that is', async () => {
    const old = doc({ _id: 'old', idempotencyKey: 'k-old', createdAt: new Date('2026-07-01T00:00:00Z') })
    const r = new GoldLedgerReader(fakeDb([old, first, second]))

    const audit = await r.auditChain('cust1', 'asset_fg')
    expect(audit.verdict.valid).toBe(true)
    expect(audit.chainedEntries).toBe(2)
    // Reported rather than hidden: a caller must be able to say the guarantee
    // covers two of three entries, not imply it covers all of them.
    expect(audit.unchainedEntries).toBe(1)
    expect(audit.chainedFrom).toEqual(first.createdAt)
  })

  it('passes an identity whose history is entirely pre-cutover, covering nothing', async () => {
    // Not a break. Reporting these as failures would bury every real one.
    const r = new GoldLedgerReader(fakeDb([doc()]))
    const audit = await r.auditChain('cust1', 'asset_fg')
    expect(audit.verdict.valid).toBe(true)
    expect(audit.chainedEntries).toBe(0)
    expect(audit.chainedFrom).toBeNull()
  })

  it('catches an edited amount, and every entry after it', async () => {
    const tampered = { ...first, amount: 1_000_000 }
    const r = new GoldLedgerReader(fakeDb([tampered, second]))

    const audit = await r.auditChain('cust1', 'asset_fg')
    expect(audit.verdict.valid).toBe(false)
    // Both: the edited row no longer matches its own hash, and the row after
    // it no longer opens where the edited one now closes. That second failure
    // is the property chaining buys — a tamperer has to rewrite the rest too.
    expect(audit.verdict.problems.length).toBeGreaterThan(1)
  })

  it('fails an unchained row that appears after chained ones', async () => {
    // Impossible while postEntry is the only writer, which is exactly why it
    // is left to fail loudly rather than filtered out as noise.
    const r = new GoldLedgerReader(fakeDb([first, doc({ _id: 'rogue', idempotencyKey: 'k-rogue' })]))
    expect((await r.auditChain('cust1', 'asset_fg')).verdict.valid).toBe(false)
  })
})
