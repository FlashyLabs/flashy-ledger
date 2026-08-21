# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] — 2026-08-21

### Added

- **Experience settles on these books.** Five `SKILL_XP` assets — `xp-int`,
  `xp-str`, `xp-ins`, `xp-inf`, `xp-com` — with `skillAsset`, `skillAssets`,
  `skillAssetRegistry` and `skillForAssetId`. Zero decimals, because XP is
  indivisible. Nothing in the engine knows what "Intelligence" means; a skill is
  a configuration record, exactly like wheat.

  The asset ids are stable machine names rather than database ids, and they are
  pinned by a test written out in literals. They go into every entry hash, so
  renaming one does not migrate a chain — it invalidates one.

- **`xpIdempotencyKey(product, activity, entityId, identityId)`.** The key
  convention in one function so every product in the network derives it
  identically. This is what makes one hunter's XP the same hunter's XP across
  ClaimYour.Gold, Flashy Academy and whatever ships next: two products awarding
  the same lesson collide on the key and the store's uniqueness constraint pays
  once. A convention documented in prose is a convention two teams implement
  differently.

- **`isTransferable(asset)`, and `postTransfer` now enforces it.** Skill assets
  cannot move between identities and the attempt raises
  `ASSET_NOT_TRANSFERABLE`.

  Experience is a claim about who earned something. The moment it can be handed
  to someone else it is a market, and a market in status is a currency by
  another name — which is the exact thing the XP/gold separation exists to
  prevent. The previous statement of this rule was a sentence in a doc comment
  claiming the ledger enforced it while no code did.

  Currency, commodities and partner credit are unaffected: raids and the
  marketplace need commodities to move.

### Note on provenance

This release folds in the experience domain from an unreleased fork that
shipped as `@flashy/ledger@0.2.0` — the same version number as this package's
0.2.0 and different contents, because it branched before the tenant-isolation
work. The fork's consumer only ever used the pure domain functions (`post`,
`minor`, `skillAsset`), so 0.2.0's breaking changes to the store read
signatures do not affect it. The fork is superseded; the vendored tarball
carrying it should be deleted wherever it appears.

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
