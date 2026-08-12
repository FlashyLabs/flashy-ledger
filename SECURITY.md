# Security

## Reporting

Report suspected vulnerabilities through Member Support rather than a public
issue. We confirm receipt with a reference and ask for reasonable disclosure
time.

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
