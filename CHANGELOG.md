# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-08-14

### Added

- Experience on the books: `SKILL_XP` asset class and the five hunter skill
  assets (`skillAsset`, `skillAssets`, `skillAssetRegistry`,
  `skillForAssetId`, `SKILL_KEYS`) — XP settles with the same append-only,
  hash-chained, idempotent discipline as gold. See ClaimYour.Gold's
  `docs/xp-system-architecture.md` for the system this serves.
- `MIGRATION` and `DECAY` entry kinds: backfills and principled loss are
  posted, never mutated.
- `xpIdempotencyKey` — the one shared derivation
  (`<product>:<activity>:<entityId>:<identityId>`) so every product builds
  replay-safe keys the same way.
- Dual build: ESM (`dist/esm`) and CommonJS (`dist/cjs`), so Next.js apps
  and jest-based test suites can consume the package without transforms.

## [0.1.0]

### Added

- Pure ledger domain: `post`, `postTransfer`, `reverse`, balance folds.
- `Minor` branded type with exact integer arithmetic and precision guards.
- Content hashing and chain verification (`hashEntry`, `verifyEntry`, `verifyChain`).
- Multi-asset support: assets carry their own symbol, precision and class.
- `LedgerStore` port and an in-memory reference adapter.
- CI gating typecheck, strict lint, tests, coverage thresholds and dependency audit.
