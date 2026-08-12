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
