# The invariants, numbered

The artifact an auditor asks for: every guarantee this package makes, stated
once, numbered so it can be cited, and mapped to the executable check that
proves it. A guarantee with no test behind it is a preference.

`tests/invariants.test.ts` asserts that this table and the code agree — every
invariant below names a test that exists, and the count here matches the count
there. The document cannot drift from the suite without failing the build.

## I-1 · Append-only

**Claim.** An entry, once written, is never modified or removed. A correction is
a new entry that references what it corrects.

**Why.** History you can edit is not evidence. The incident register, the
inclusion proofs and the anchored roots all rest on this one.

**Enforced by.** `LedgerStore` exposes no update and no delete — not as policy
but as absence, so there is no method to call. `reverse()` produces a
compensating entry rather than mutating the original.

**Proved by.** `ledger.test.ts` › *undoes by mirroring, never by editing history*,
and the two tamper checks that make the absence detectable rather than merely
intended: › *detects an entry edited after the fact* and
› *detects a removed entry by the break it leaves in the chain*.

## I-2 · Signed integer minor units

**Claim.** Every amount is a whole number of the asset's smallest unit, carried
as a branded `Minor`. Never a float, never a formatted string.

**Why.** Binary floating point cannot represent most decimal fractions exactly,
so sums drift as volume grows. The predecessor stored amounts as `Float` and 185
production rows disagreed with their own balance movement. See ADR 0002.

**Enforced by.** The `Minor` brand, so a raw number cannot be passed by accident;
`fromDecimal` throws `PrecisionError` on more precision than the asset allows,
rather than rounding.

**Proved by.** `ledger.test.ts` › *rejects precision the asset cannot hold rather than rounding it*,
› *rejects non-finite and non-integer values*, and
› *adds exactly where floating point would not* — the last being the case the
predecessor failed in production.

## I-3 · One sign convention

**Claim.** Credits are positive, debits negative, everywhere, with no unsigned
variant and no separate debit function.

**Why.** So that `SUM(amount)` means something. The predecessor had services
writing debits both ways, which made the sum meaningless and is precisely why
the reconciliation invariant on flashy.network cannot yet run.

**Enforced by.** `post()` derives `balanceAfter` from the signed amount. There is
no API that takes a magnitude and a direction.

**Proved by.** `ledger.test.ts` › *debits with a negative amount, one convention throughout*,
and › *produces a matched debit and credit, never a bare balance edit*.

## I-4 · Idempotent writes

**Claim.** A write carries a key derived from its source event. A replay of that
key returns the original entry and writes nothing.

**Why.** Retries are constant at scale, and a retry that awards twice is a money
bug that looks like generosity.

**Enforced by.** A unique index on `(tenantId, idempotencyKey)`, so the database
refuses a duplicate even when two processes race — code in one file runs once per
process, an index runs on every write from every process forever.

**Proved by.** `conformance.test.ts` › *returns the original entry when a key is replayed, and writes nothing*,
run against every adapter, and
› *still deduplicates a genuine replay within one tenant*, which guards the
scoping change in I-6 from over-correcting into a lost deduplication.

## I-5 · Balances are derived

**Claim.** A balance is a fold over entries. Any stored balance is a cache of
that fold and must be rebuildable from it at any time.

**Why.** A cache can be rebuilt; a truth cannot. This is what lets projections be
sharded, rebuilt or thrown away, and what makes Σ(entries) = Σ(balances) a
meaningful question rather than a tautology.

**Enforced by.** `balanceOf()` folds entries; stores hold projections and are
never the source.

**Proved by.** `ledger.test.ts` › *derives a balance from entries alone*, and
› *keeps assets separate on one identity*, so the fold is per asset rather than
per identity.

## I-6 · Tenant isolation

**Claim.** Every read and every uniqueness constraint is scoped to one tenant. No
read returns another tenant's entry, and no write is refused because a different
tenant used the same idempotency key.

**Why.** Added in 0.2.0. `tenantId` was written onto every entry and used in no
query, which is harmless with one tenant and three money bugs with two — the
worst being a cross-tenant idempotency collision that returned another tenant's
entry while reporting a successful deduplication.

**Enforced by.** `AccountRef` and `HistoryRef` make the tenant a required
parameter, so a cross-tenant read does not compile; unique indexes on
`(tenantId, idempotencyKey)` and `(tenantId, identityId, assetId, previousHash)`;
`ensureIndexes()` drops the pre-0.2 global indexes, which would otherwise defeat
the change silently.

**Proved by.** `conformance.test.ts` › *tenant isolation* — six cases, run against
every adapter, of which four were verified to fail against the pre-0.2
implementation. The two that name the money bugs directly:
› *lets two tenants use the same idempotency key without deduplicating* and
› *scopes findByIdempotencyKey, so a lookup never returns another tenants entry*.

## I-7 · All or nothing consumption

**Claim.** A multi-asset consumption that cannot be afforded in full produces no
entries at all. No asset in the bill is debited unless every asset can be.

**Why.** Added in 0.3.0 with `postConsume`, the primitive building needs. The
failure it prevents is the partial spend: wood debited, stone found short, and
someone left poorer with nothing to show for it. That bug is silent — it surfaces
weeks later as a support ticket about missing resources, with no entry anywhere
saying what happened.

**Enforced by.** Ordering, not error handling. `postConsume` computes the
shortfalls across every cost before it produces a single entry, and throws
`InsufficientForConsumptionError` carrying all of them. The same `shortfalls()`
function answers the caller's "can this be built?", so a preview cannot disagree
with the rule. `allowNegative` is not part of `ConsumeCommand`, so a build cannot
be financed with debt by passing a flag.

Completeness of an *affordable* build is the store's guarantee, not the domain's:
the entries go to `appendAll` on a `TransactionalLedgerStore`. A loop over
`append` that fails on the third leg has spent the first two — the same failure,
one layer down.

**Proved by.** `consume.test.ts` › *destroys nothing — not even the assets it could have paid for*,
› *reports every shortfall, not the first one found*,
› *offers no way to finance a build with debt*, and
› *lands every leg together, and each asset keeps its own verifiable chain*.

