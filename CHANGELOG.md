# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Pure ledger domain: `post`, `postTransfer`, `reverse`, balance folds.
- `Minor` branded type with exact integer arithmetic and precision guards.
- Content hashing and chain verification (`hashEntry`, `verifyEntry`, `verifyChain`).
- Multi-asset support: assets carry their own symbol, precision and class.
- `LedgerStore` port and an in-memory reference adapter.
- CI gating typecheck, strict lint, tests, coverage thresholds and dependency audit.
- `GoldLedgerReader.auditChain` and `isChained`: verify the chained suffix of a
  chain-forward ledger and report how much of the history that actually covers,
  instead of failing pre-cutover rows that were never chained.

### Fixed

- `GoldLedgerReader` discarded the `previousHash`/`hash` fields and always
  reported a null chain head. ClaimYour.Gold's `postEntry` had begun writing
  both, so chained entries read back as unchained — nothing could verify them,
  and a caller posting from the null head would have started a second chain
  beside the live one.
