# Security

## Reporting

Report suspected vulnerabilities to **security@flashy.network** rather than a
public issue. We acknowledge within 72 hours and tell you what we are doing.

This is the same address and the same commitment published at
https://flashynetwork.com/security/ . One disclosure route across the estate is
deliberate: a researcher who finds two and picks the worse one has been failed
by us, not by their choice.

If a report reveals a discrepancy in a ledger, it appears on
https://flashynetwork.com/incidents/ once corrected — including the ones we would
rather not publish.

## What this package guarantees

- **Tamper-evidence.** Entries are content-hashed and chained. Altering history
  breaks every hash after the edit; `verifyChain()` detects it.
- **No double-award.** Writes are idempotent under a stable key, so a replayed
  or retried command returns the original entry.
- **No silent rounding.** Amounts carrying more precision than the asset allows
  are rejected, never rounded.

## What it does not

- It does not authenticate callers. Authorisation belongs to the service in
  front of it.
- Hash chaining is tamper-*evident*, not tamper-*proof*. An actor who can
  rewrite the whole chain and every downstream hash can still forge history;
  detecting that requires publishing chain heads somewhere they cannot reach.
- It holds no secrets and opens no connections.

## Handling the entry format

Changing the fields hashed by `hashEntry`, or their order, invalidates every
chain written before the change. Treat it as a breaking migration with a
re-hashing plan, not as a refactor.

## Response and disclosure windows

Acknowledgement within 72 hours, a status update at least every 7 days
until resolution, and coordinated disclosure: give us 90 days — or agree a
different window with us — before publishing.

## Supported versions

The latest published minor. Older versions get fixes only when the finding
is severe and the upgrade path is breaking.
