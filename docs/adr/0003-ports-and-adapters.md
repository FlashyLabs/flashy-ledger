# ADR 0003 — The domain is pure; storage sits behind a port

**Status:** Accepted · 2026-08-12

## Context

The ledger may move onto different infrastructure, potentially including a
chain. In the predecessor, business rules and Prisma calls were interleaved in
the same functions, so the storage engine was load-bearing for the rules and
could not be changed without rewriting them.

## Decision

`src/domain` is pure: no database, no clock, no randomness, no network. `post()`
takes current state and a command and returns the entry that should exist. All
persistence sits behind `LedgerStore` in `src/ports`. A lint rule fails the
build if anything under `src/domain` reaches for `Date.now()` or `Math.random()`.

Time enters as an explicit `occurredAt` on the command.

## Consequences

Good: swapping storage means writing one adapter. The rules are exhaustively
testable with no infrastructure, which is why the domain runs at 99% coverage
in milliseconds. The same conformance suite runs against every adapter, so a
backing store either behaves identically or fails the build.

Costs: callers read state and post in two steps, and concurrent posters can race
on the same head. Stores resolve that with the uniqueness constraint on
`idempotencyKey`, which is where it belongs.

Rejected: an ORM-centred design, which is what produced the problem this package
exists to fix.
