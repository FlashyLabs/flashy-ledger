# ADR 0002 — Amounts are signed integers in minor units

**Status:** Accepted · 2026-08-12

## Context

The predecessor stored `amount`, `balanceBefore`, `balanceAfter` and two
`goldBalance` columns as `Float`. Binary floating point cannot represent most
decimal fractions exactly, so sums drift as volume grows. Separately, the same
column carried two contradictory sign conventions — some services wrote debits
negative, others wrote them positive while decrementing the balance — which made
`SUM(amount)` meaningless. 185 production rows disagreed with their own balance
movement.

## Decision

Every amount is a `Minor`: a signed, whole number of the asset's smallest unit,
interpreted against `Asset.decimals`. Positive credits, negative debits, with no
unsigned variant and no separate debit function to reintroduce the ambiguity.
`Minor` is a branded type, so a raw number cannot be passed by accident.

`fromDecimal` rejects any value carrying more precision than the asset permits
rather than rounding it.

## Consequences

Good: arithmetic is exact, `SUM(amount)` is a balance, and the representation
matches what a chain would require. Rejecting over-precision means no entry can
silently invent or destroy value.

Costs: callers must convert at the boundary, and amounts are bounded by the
exact integer range (2^53-1). Both are checked and throw rather than truncate.

Rejected: decimal libraries, which solve precision but not the sign-convention
problem and add a dependency to the hot path.
