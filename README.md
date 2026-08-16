# The Flashy Ledger

One book, for Flashy Gold and every asset that follows it.

Companion to `flashyos/docs/architecture.md` and the boardroom brief *The Common Rail*.

---

## Why this repository exists

Claim Your Gold currently keeps value in **three parallel ledgers**, two of which each describe themselves in code as the single source of truth, and stores every amount as a `Float`. That is survivable at human volume, where a few thousand redemptions a day are each seen by someone who would notice a discrepancy. It is not survivable at agent volume, which is precisely a system with nobody watching any individual transaction.

This service is the one book. It is greenfield on purpose: the alternative was migrating a live money database in place, which is a far more dangerous way to arrive at the same schema.

## The two properties everything else depends on

**Money is an integer.** Every amount here is a `BigInt` in the asset's minor units. There is no `Float` in the schema, no `number` in the money path, and `parseAmount` takes a `string` because by the time a value is a JS `number` the precision loss has already happened. Excess precision is rejected rather than rounded — silent rounding is how a ledger loses a fraction of a unit per transaction and nobody notices for a year.

**Every movement is double-entry.** A `Transfer` creates two or more `Entry` rows that sum to exactly zero. This is not bookkeeping ceremony; it converts *"is the ledger correct?"* from an unanswerable question into a single query:

```sql
SELECT "assetId", SUM(amount) FROM "Entry" GROUP BY "assetId";  -- must be 0, forever
```

A single-sided write — the bug class that silently destroys ledgers — cannot hide from that, no matter how long ago it happened or how well a compensating balance update concealed it.

## Balances are a projection

`Account.balance` is a cache of that account's entries, written inside the same transaction as the entries it summarizes. `recomputeBalance()` derives the authoritative number from entries alone, and `rebuildBalances()` must be safe to run at any moment and change nothing.

This is the same rule FlashyOS applies to org reputation: **standing is derived from events, never stored as an assertion.** If running a rebuild moves a balance, the invariant checker was already reporting that account and the product had been showing a wrong number.

## Parties: people and organizations

An account holder is a `Party` — `PERSON`, `ORG`, or `SYSTEM`.

Organizations hold value **in their own right**, not through whoever founded them. This is what makes agent spending auditable: an agent draws on its org's account, so its spending can be capped, attributed, and cut off. Drawn from a founder's personal balance it would be indistinguishable from their grocery money.

`SYSTEM` is the counterparty for value entering or leaving circulation. Minting is an ordinary transfer whose other leg lands on the issuer, which keeps the zero-sum invariant true with no carve-outs — and makes *"how much has ever been issued?"* answerable as the issuer's negative balance rather than a number someone maintains by hand.

## Settlement: chains plug in below, never above

```
   surfaces  ─────────────────────────────►  read balances, request transfers
                          │
   THE LEDGER  ───────────┴───────────────►  authoritative. always.
                          │
   settlement adapters  ──┴───────────────►  native (default) · chain · chain
```

A settlement venue is a place a transfer is **mirrored**, never where it is **decided**.

The ledger is the book; a chain is a wire network. Banks did not move their books onto SWIFT, for the same reasons: if balances lived on-chain then a chain's outage would be a product outage, its fees would be our unit economics, its governance would be our governance — and unplugging it would mean losing the balances, so we never could.

The `SettlementAdapter` contract is therefore deliberately narrow, and has **no method for reading a balance from a venue**. The moment the ledger asks a chain what someone holds, the chain is the book and everything above it is decoration.

**The test of the seam is removal.** `settlement.test.ts` unplugs a venue and asserts that settlement carries on, balances are untouched, and history stays honest about where value was once mirrored. If those tests ever fail, a chain has become load-bearing and the architecture has quietly inverted.

## Invariants

`checkInvariants()` runs four checks and **reports** — it never corrects:

| Invariant | Catches |
|---|---|
| `global_zero_sum` | Any single-sided write in an asset's entire history |
| `transfer_balances` | Which specific transfer broke the book |
| `balance_matches_entries` | A cached balance drifting from its entries |
| `no_unauthorized_negative` | Value spent that was never issued |

Detection and correction are two separate calls on purpose. A checker that quietly fixes what it finds destroys the evidence of how the discrepancy arose — and the discrepancy was never the real problem; the bug that produced it is, and it is still there.

**The gate for putting real value on this book is these green for 30 consecutive days** — not "the migration merged."

## Status

Schema, money type, transfer path, parties, invariants and the settlement seam are implemented with 73 tests passing. **Nothing is wired to a live database yet, and no data has been migrated from Claim Your Gold.** The migration of the existing three ledgers is `LED-0` and needs a staging environment and production access — it is not something to attempt blind.

```bash
npm install
npx prisma generate
npm test
npm run typecheck
```
