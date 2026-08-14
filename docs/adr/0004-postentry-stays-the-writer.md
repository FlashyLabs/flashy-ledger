# ADR 0004 — `postEntry` stays the writer; this package reads and defines

**Status:** Accepted · 2026-08-14

## Context

The ecosystem roadmap's ledger phase reads, in order: decide the entry format,
write the adapter over `gold_ledger`, reduce ClaimYour.Gold's `postEntry` to a
shim over this package, delete `src/ledger/`. The stated payoff for the third
step is that all of `postEntry`'s call sites stay untouched.

The first two are done. The format decision is chain-forward — new entries link
to their predecessor from a marked boundary, historical rows keep their shape —
and `postEntry` writes the chain using this package's `hashEntry`, while
`GoldLedgerReader` reads it back and `auditChain` verifies it.

The third step was then measured rather than assumed. Of 183 `postEntry({...})`
call sites in ClaimYour.Gold, **129 across 93 files pass an outer `tx`**: a
Prisma transaction client belonging to the caller, so that the ledger entry, the
wallet update and the caller's own work — resolving a bounty, settling a duel,
completing a quest — commit together or not at all.

`LedgerStore` has no equivalent. It is written against the `mongodb` driver, and
its atomicity guarantee covers the entry and its own projection, not a
transaction opened by a caller in another repository using a different client.

## Decision

`postEntry` remains the only writer of `gold_ledger`. This package supplies the
format — `hashEntry`, the `Entry` shape, the domain rules — and reads the result
through `GoldLedgerReader`. It does not gain a writer for that collection.

The read/write split is enforced by the type: `GoldLedgerReader` does not
implement `append`, so a consumer that tries to write fails to compile rather
than at runtime, against money.

## Consequences

Good: the atomicity 129 call sites already depend on is preserved without any
of them being edited, which was the goal that made the shim attractive in the
first place. The format is still owned in one place, so the two repositories
cannot drift on what a hash covers — the cross-repo contract is asserted in
`tests/gold-ledger.test.ts`, which builds a row exactly as `postEntry` builds
one and fails here if either side moves.

Costs: `src/ledger/postEntry.ts` is not deleted, and ClaimYour.Gold keeps ledger
code. Two implementations of "append an entry" exist — this package's, used by
new consumers on `ledger_entries`, and `postEntry`'s, used by the live economy
on `gold_ledger`. They agree on the format and nothing enforces that they keep
agreeing except the contract test.

## What would change this

The shim becomes correct once either:

- `LedgerStore` gains a way to join a caller-supplied transaction — a session
  or unit-of-work parameter threaded through `append`. That is a real widening
  of the port and would have to hold for every adapter, including a future
  chain-backed one, where "join my transaction" may have no meaning; or
- the 129 sites stop needing it, because the work they commit alongside the
  entry moves behind the same boundary.

Neither is a small change, and both are cheaper than discovering after the fact
that a bounty payout and its ledger entry stopped being atomic. Rejected for
now: shipping the shim and accepting non-atomic writes on the grounds that the
window is small. The window is small and the ledger is money; that trade has
already been made once in this estate and it is the reason this package exists.
