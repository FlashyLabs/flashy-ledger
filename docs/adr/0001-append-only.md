# ADR 0001 — The ledger is append-only

**Status:** Accepted · 2026-08-12

## Context

The predecessor system stored a balance as a mutable column and wrote history
beside it, inconsistently. A production reconciliation found 139 code paths
writing balances directly, 61 of which wrote no history at all, and 175 places
where the recorded history contradicted itself. With a mutable balance there is
no way to tell a bug from a legitimate movement after the fact.

## Decision

Entries are never updated and never deleted. A mistake is corrected by posting
an offsetting entry. `LedgerStore` deliberately exposes no update or delete.

## Consequences

Good: history is evidence. Every balance decomposes into the events that
produced it, disputes are resolved against the record, and corrections are as
auditable as the mistakes. Appends also do not contend with each other, which is
the property that lets the write path shard.

Costs: storage grows monotonically, and reads that need a current balance must
either fold entries or consult a projection. Both are accepted — storage is
cheap and projections are rebuildable.

Rejected: soft deletes, which are mutation wearing a costume.
