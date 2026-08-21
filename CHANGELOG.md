# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] — 2026-08-21

### Added

- **`MongoLedgerStore` can address a collection it did not design.** A `FieldMap`
  names where each field lives, so the adapter reads and writes an existing
  collection in place instead of requiring its rows to be copied into a new one.
  That is the difference between a migration and a swap: a migration against
  live money is a project with a rollback plan, a swap is a configuration line.
  `GOLD_LEDGER_FIELDS` maps ClaimYour.Gold's `gold_ledger`.

  Three refusals are deliberate. Two fields mapped to one key (the second write
  overwrites the first and the entry read back is not the entry written). A
  timestamp replacing `_id` as the chain order (two entries in the same
  millisecond have no order, so `_id` stays as the tiebreak). And an amount that
  is not already a whole number of minor units — converting decimal majors here
  would be float arithmetic deciding a balance, at the boundary nobody reads, so
  it throws and names the migration that has to happen first.

  Every query and every index routes through the map. A map covering reads but
  not indexes would leave tenant isolation unenforced on the adopted collection,
  which is the worst outcome available: it would look adopted.

### Changed — BREAKING

- **`identityId` must be opaque.** `post()` now refuses an identity that looks
  like a natural key — an email address, an E.164 phone number, an EVM or TON
  wallet address, or a public key — before anything is hashed. See I-8.

  This is breaking for any consumer passing one of those today. It is breaking
  on purpose: such a value identifies a person, correlates across tenants with
  no shared namespace at all, and cannot be removed from a chain once hashed
  into it. `surrogateIdentity(value, tenantSalt)` derives a replacement, and its
  per-tenant salt gives the pairwise property for free.

  The patterns are narrow by design. ObjectIds, ULIDs, UUIDs, nanoids and bare
  integers are untouched, and base58 is not attempted, because a guard with
  false positives gets switched off and then nothing is checked.

### Fixed

- **The conformance job runs against an actual replica set.** It had been
  failing for months on a standalone mongod: a `services:` container cannot take
  command arguments, so `--replSet` was never passed, while the readiness gate
  checked `isWritablePrimary` — which a standalone reports true. It announced
  success against a server with no replication, and the suite then failed on
  "Transaction numbers are only allowed on a replica set member", which reads
  like a broken adapter. The gate now checks `setName`.

- vitest and `@vitest/coverage-v8` to 4.1.11, clearing a critical advisory in
  the vitest UI server and a high path-traversal advisory in the vite it pulls.
  Dev-only; neither ships in the package.

## [0.3.0] — 2026-08-20

### Added

- **`postConsume` — multi-asset consumption, all or nothing.** The primitive
  building needs: a bill of several assets at once, where an unaffordable build
  spends nothing. Sufficiency is decided for every cost before a single entry is
  produced, and the error carries every shortfall rather than the first, so
  nobody discovers their own bill one line at a time.

  `shortfalls()` and `canConsume()` are exported so a caller can ask before it
  commits. The preview and the rule are the same function, so they cannot
  disagree.

  Three deliberate refusals: the same asset twice (both lines would check
  against one balance and both entries would chain onto one head, forking that
  asset's chain — sum them before calling), a zero or negative line, and debt.
  `allowNegative` is not part of `ConsumeCommand` at all; a build financed by
  credit is a product decision that should have to be written.

  Completeness of an *affordable* build belongs to the store: pass the entries
  to `appendAll` on a `TransactionalLedgerStore`, never to `append` in a loop.

- `InsufficientForConsumptionError`, carrying a `Shortfall[]`, and the
  `INSUFFICIENT_FOR_CONSUMPTION` and `DUPLICATE_ASSET_IN_COMMAND` codes.

- **`docs/INVARIANTS.md`** — the seven guarantees this package makes, numbered
  so they can be cited, each mapped to the test that proves it.
  `tests/invariants.test.ts` fails the build if the document cites a test that
  no longer exists, so a rename cannot quietly hollow out the spec.

## [0.2.0] — 2026-08-14

### Changed — BREAKING

- **Tenant isolation is enforced rather than carried.** `tenantId` was written
  onto every entry and used in no query, no index and no signature. Reads now
  take a scope object and every uniqueness constraint is tenant-scoped:
  - `readState(ref: AccountRef)` — was `readState(identityId, assetId)`
  - `readEntries(ref: HistoryRef)` — was `readEntries(identityId, assetId?)`
  - `findByIdempotencyKey(tenantId, key)` — was `findByIdempotencyKey(key)`
  - `GoldLedgerReader.readRecentEntries(ref, limit)` and `verifyBalance(ref)`

  Reads take an object because three same-typed positional parameters are
  transposable and this one decides whose money you are looking at.

- **Mongo indexes are tenant-scoped and the pre-0.2 ones are dropped on
  `ensureIndexes()`.** A surviving global `uniq_idempotency` silently defeats
  the change: it would still reject a second tenant's legitimate write while
  the new index permits it, so creating the new indexes without removing the old
  would look like a migration and behave like none.

  | Was | Now |
  |---|---|
  | `uniq_idempotency` | `uniq_tenant_idempotency` |
  | `uniq_chain_head` | `uniq_tenant_chain_head` |
  | `chain_order` | `tenant_chain_order` |

### Added

- Six tenant-isolation cases in the conformance suite, run against every
  adapter. Four of them fail against the pre-0.2 implementation; that was
  verified by reverting the fix and watching them go red, because a test that
  passes before and after the change it guards is not a test.
- `tests/public-api.test.ts` — the export surface written out by hand, so
  removing an export fails the build and a human has to decide whether the
  major version moves.

### Fixed

- Cross-tenant idempotency collision. Keys derive from source events —
  `quest:q_9:identity_1` is this package's own example — so two networks
  running similar mechanics collide by construction. Globally scoped, a second
  tenant's award silently returned the first tenant's entry, reporting a
  successful deduplication: a lost award and a cross-tenant disclosure in one
  code path.
- Cross-tenant chain-head rejection, where two tenants' first entries for the
  same identity and asset both carry `previousHash: null` and the second was
  refused as a duplicate.
- Cross-tenant reads, where a balance — a fold over entries — became the sum of
  two networks' books.

## [0.1.2] — 2026-08-14

### Changed

- Package renamed to `@flashylabs/ledger` to match the GitHub account.

## [0.1.1] — 2026-08-14

### Added

- CommonJS build alongside ESM; `mongodb` 7 accepted and the peer made optional.
- Publishing to GitHub Packages, driven by a tag.

## [0.1.0] — 2026-08-14

First tagged release. Contents as listed below.

### Added

- Pure ledger domain: `post`, `postTransfer`, `reverse`, balance folds.
- `Minor` branded type with exact integer arithmetic and precision guards.
- Content hashing and chain verification (`hashEntry`, `verifyEntry`, `verifyChain`).
- Multi-asset support: assets carry their own symbol, precision and class.
- `LedgerStore` port and an in-memory reference adapter.
- CI gating typecheck, strict lint, tests, coverage thresholds and dependency audit.
