# @flashy/ledger

An append-only, multi-asset settlement ledger. Flashy Gold is the first asset on
it, not the thing itself — ore, stone and wheat are configuration records, not
new code paths.

The domain is pure. It reads no database, calls no clock, and generates no
randomness. Everything that touches storage sits behind one interface, which is
the entire reason this can move onto different infrastructure — including a
chain — without its rules changing.

## Install and check

```bash
npm ci
npm run check     # typecheck + lint + tests with coverage gates
```

## Using it

```ts
import {
  InMemoryLedgerStore, post, fromDecimal, type Asset,
} from '@flashy/ledger'

const gold: Asset = {
  id: 'asset_fg', slug: 'flashy-gold', symbol: 'FG',
  decimals: 2, class: 'REWARD_CURRENCY', tenantId: 'flashy',
}

const store = new InMemoryLedgerStore()

const state = await store.readState('identity_1', gold.id)
const entry = post(state, {
  tenantId: 'flashy',
  identityId: 'identity_1',
  asset: gold,
  amount: fromDecimal(25, gold.decimals),   // 2500 minor units
  kind: 'EARN',
  source: { type: 'quest', id: 'q_9' },
  idempotencyKey: 'quest:q_9:identity_1',   // stable, not a timestamp
  occurredAt: new Date(),
})

await store.append(entry)
```

Transfers are two entries, never one balance edit:

```ts
const [debit, credit] = postTransfer(
  { state: senderState, identityId: 'a' },
  { state: recipientState, identityId: 'b' },
  { tenantId: 'flashy', asset: gold, amount: fromDecimal(5, 2),
    source: { type: 'gift' }, idempotencyKey: 'gift:g_1', occurredAt: new Date() },
)
await store.appendAll([debit, credit])   // both land, or neither
```

## The five invariants

Everything here follows from these. They are enforced in code, checked in tests,
and repeated on the PR template because they are easy to erode one convenience
at a time.

| Invariant | Why | Enforced by |
| --- | --- | --- |
| **Append-only** | History you can edit is not evidence | No update or delete on `LedgerStore` |
| **Signed integer minor units** | Floats drift; chains reject fractions | `Minor` branded type; `fromDecimal` rejects over-precision |
| **One sign convention** | `SUM(amount)` must mean something | `post()` derives balances from the signed amount |
| **Idempotent writes** | Retries are constant at scale | Unique `idempotencyKey`; a replay returns the original |
| **Balances are derived** | A cache can be rebuilt; a truth cannot | `balanceOf()` folds entries; stores hold projections |

## Layout

```
src/
  domain/     Pure. No I/O, no clock, no randomness.
    money.ts    Minor units, exact arithmetic
    asset.ts    Asset records — gold, ore, stone, wheat
    entry.ts    Entry shape, content hashing, chain verification
    post.ts     The decision function: state + command -> entry
    fold.ts     Balances as folds over entries
    errors.ts   Typed rejections
  ports/
    store.ts    The seam. The only thing a new backing store implements.
  adapters/
    memory.ts   Reference implementation and executable specification
```

The dependency rule is one-directional: `adapters` depend on `ports` depend on
`domain`, and `domain` depends on nothing. A lint rule fails the build if
anything under `src/domain` reaches for `Date.now()` or `Math.random()`.

## Why the hash chain

Each entry carries the hash of the one before it for that identity. Altering an
old entry changes its hash and breaks every hash after it, so tampering is
detectable without anyone having to trust the operator.

That property is worth having on its own. It also means a merkle export — and
therefore a migration onto a chain — is a mechanical exercise rather than a
research project. `verifyChain()` is what an auditor runs.

## Adding an asset

Register it. There is no second step.

```ts
const wheat: Asset = {
  id: 'asset_wht', slug: 'wheat', symbol: 'WHT',
  decimals: 0,                    // whole units only
  class: 'COMMODITY_UNIT', tenantId: 'flashy',
}
```

Precision is per asset and enforced at the boundary: `fromDecimal(0.5, 0)`
throws rather than rounding, because rounding somebody's holding is not a thing
a ledger may do quietly.

Multi-asset does **not** mean assets exchange freely. Conversion is a commercial
decision with its own controls; the ledger records it as two entries and does
not invent a rate.

## What this package is not

- **Not a wallet or an identity system.** It records movements against an
  identity id it is given.
- **Not a pricing engine.** No rates, no conversion, no valuation.
- **Not on a chain, and not pretending to be.** It is built so that becoming so
  is a storage decision rather than a rewrite.

## Status

Pre-1.0. The entry format and hash input are not yet frozen — changing either
invalidates existing chains, so both will be locked before the first production
write. See `docs/adr/` for the decisions behind the design.

## The mongodb peer dependency

`mongodb` is an **optional** peer, accepted at `^6.21.0 || ^7.0.0`.

Optional because the domain — `post`, `postTransfer`, `hashEntry`,
`verifyChain`, the money helpers — imports no driver at all. A consumer that
only needs the rules, or that brings its own storage, should not be made to
install a database driver to get them. ClaimYour.Gold is exactly that consumer
today: it computes hash chains with this package and writes through Prisma.

The range spans both majors because the adapters use only driver APIs that did
not change between them: `collection`, `createIndex`, `insertOne`, `findOne`,
`find`/`sort`/`limit`/`toArray`, `startSession`, `withTransaction`,
`endSession`. Pinning to v6 forced consumers on v7 into `--legacy-peer-deps`,
which silences every peer conflict in the tree rather than the one that was
actually understood.

