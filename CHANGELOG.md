# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0] — 2026-08-27

### Added — the four civilization commodities

- **`WHEAT`, `WOOD`, `STONE`, `IRON`**, and `CIVILIZATION_COMMODITIES` listing
  them in unlock order. All four are `COMMODITY_UNIT` at `decimals: 0`, and all
  four now appear in `FLASHY_ASSET_DEFINITIONS`.

  ClaimYour.Gold has carried these as four `Asset` rows and a hand-written slug
  map since before this registry existed. That is the shape this registry was
  built to end: the same asset declared in two places is the same asset until
  somebody edits one of them. Zero decimals in particular is not a display
  preference — amounts are hashed as minor units, so a decimals disagreement
  silently reinterprets every historical entry.

  There is no conversion path from any of them to Flashy Gold, under any name.
  Gold may buy commodities; that direction is a sink for a currency people can
  redeem, and it is the only direction that exists.

### Added — enforcement of a rule that was already written down

- **`isTransferable(asset)`, and `postTransfer` now enforces it.** A `SKILL_XP`
  asset cannot move between identities; the attempt raises
  `ASSET_NOT_TRANSFERABLE` and produces no entries.

  The asset-class comment has said XP is "never convertible" since the
  experience domain landed, and the doc block on `experience.ts` states the
  ledger enforces the half it can see. Nothing did. A sentence in a comment and
  a check in `postTransfer` are not the same artefact, and only one of them
  survives a contributor who has not read the comment.

  The rule matters because Flashy Gold is redeemable. Experience is a claim
  about who earned something; once it can be handed to someone else it is a
  market, and a market in status is a currency by another name — sitting one
  conversion away from a currency that buys gift cards.

  Currency, commodities and partner credit are unaffected: raids and a
  marketplace need commodities to change hands.

  Consumption is deliberately left open. Whether XP can be *spent* on something
  is a product decision that should have to be written down, not one this
  predicate forecloses. What it forecloses is XP changing hands.

## [0.6.3] — 2026-08-25

### Changed

- **The release that finally goes end-to-end.** 0.6.1 and 0.6.2 were both
  claimed on GitHub Packages by manual publishes from an operator machine
  during token rotation, before the workflow could release them — so neither
  reached the npm mirror or got a tag, and the workflow rightly refuses to
  publish over an existing version. The publish step now authenticates with
  the workflow's own GITHUB_TOKEN (nothing left to rotate); 0.6.3 is the
  same tree, released once, through one pipeline, to both registries.

## [0.6.2] — 2026-08-25

### Changed

- **Re-cut of 0.6.1, identical contents.** 0.6.1's release run died between
  registries: the version reached GitHub Packages (a manual publish while the
  repo tokens were being rotated) but never the npm mirror, and never got its
  tag. Rather than publish two different artifacts under one number, 0.6.2 is
  the same tree released properly through the workflow — both registries, one
  tag.

## [0.6.1] — 2026-08-25

### Changed

- **First dual-registry release.** No code change. With the `NPM_TOKEN`
  repository secret in place, the publish workflow's mirror step stops
  skipping: this and every future release lands on GitHub Packages (the
  authenticated home) and on the public npm registry as
  [`@flashylabs/ledger`](https://www.npmjs.com/package/@flashylabs/ledger),
  so a stranger can take the open ledger rules with zero auth — which was
  the point of opening them.

## [0.6.0] — 2026-08-25

### Added

- **One asset registry, so decimals cannot disagree** (`domain/registry.ts`).
  Flashy Gold was declared independently in four places: this package's
  examples, flashy-gold, flashynetwork.com, and a row in ClaimYour.Gold's
  `assets` collection. Three said `decimals: 2`. One said `4` — and it was the
  one published on the settlement record, so an integrator following the public
  registry rendered every balance a hundred times wrong. Nothing failed, and
  nothing disagreed with them loudly enough to notice.

  - `AssetDefinition` holds what is true everywhere: slug, symbol, name,
    decimals, class, description. `Asset` adds `id` and `tenantId`, which
    describe where a copy lives — deliberately not in the definition, because
    in production the id is an environment-specific ObjectId and a slug in that
    field writes entries nothing can read back, with no type error to catch it.
  - `defineAsset()` validates at module load, so a malformed declaration is a
    startup failure in every consumer at once rather than a wrong number in one
    of them later.
  - `materialize()` supplies the id at the edge and refuses an empty one.
  - `flashyAssets()` omits an asset the environment has not provisioned rather
    than inventing an id.
  - Minting a new asset is one entry in `FLASHY_ASSET_DEFINITIONS`.

  Nineteen tests, one of which exists solely to pin FG at two decimal places:
  if it ever needs changing, the change is a migration of every entry ever
  written, not an edit to a line.

### Note on versioning

This is 0.6.0 rather than 0.5.0. The registry work was branched from the 0.4.0
line while main independently released 0.5.0, so both arrived claiming the same
version — and 0.5.0 was already published, from a build without the registry in
it. Skipping to 0.6.0 keeps the registry's published version honest rather than
re-using a number that already means something else.

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
