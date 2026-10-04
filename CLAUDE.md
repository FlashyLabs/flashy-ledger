# flashy-ledger

`@flashylabs/ledger` — an append-only, multi-asset settlement ledger, published
to npm under Apache-2.0. It is the estate's **verification layer**: the rules
flashynetwork.com checks the books against, published in the open so nobody
takes "verifiable" on faith. It ships as a **library, not a site** — there is no
`public/` build and no deploy target, which is why the estate fold-coverage
survey reads it as a record repo with no served URL rather than a gap. It is
consumed by `@flashylabs/ledger` in ClaimYour.Gold and flashy.gold. The default
branch is `main`.

**The shape is the product, and it is ports-and-adapters with teeth.** `src/domain/`
is a pure core — it reads no database, calls no clock, generates no randomness —
and everything that touches storage sits behind one interface, `LedgerStore`
(`src/ports/store.ts`). That seam is the entire migration story: a chain-backed
store can implement it later and the rules above do not change, because the rules
never knew where entries were kept. `src/adapters/` holds the implementations
(in-memory, Mongo, the read-only `GoldLedgerReader`, and the `field-map` that
lets this package's rules sit on top of a collection it did not design).

**What an agent must not break** is enumerated and executable: the numbered
guarantees in [`docs/INVARIANTS.md`](docs/INVARIANTS.md), each mapped to the test
that proves it, with `tests/invariants.test.ts` failing the build if the doc and
the suite drift. In particular — **`LedgerStore` has no update and no delete**,
and that absence is the append-only invariant (I-1); correct a mistake with
`reverse()`, never a mutation. **The `hashEntry` field order is frozen** —
changing it invalidates every chain that exists, so it is fixed deliberately, not
derived from object keys. **Amounts are signed integer `Minor` units**, never a
float or a formatted string (I-2/I-3). **Identities are opaque and tenant-scoped**,
enforced in `post()` before anything is hashed (I-8). And **the domain stays
pure** — no adapter, port, I/O builtin or third-party import reaches into
`src/domain/` (I-9, guarded by eslint for clocks/randomness and by
`tests/domain-purity.test.ts` for the import graph). Run `npm run check`
(typecheck + lint + coverage) before pushing; the roadmap, which is North Star
beyond Phase 1, is [`docs/ROADMAP.md`](docs/ROADMAP.md).

<!-- estate:house-rules -->
<!-- Synced from flashyos/tools/estate-house-rules.mjs. Edit it there, not here.
     Anything outside these two markers is this repository's own and is never
     touched by the sync. -->

## House rules — true in every repository in this estate

**`main` is not necessarily the default branch.** Eleven of thirty-five
repositories deploy from a `claude/*` branch. Ask, every time:

```bash
git symbolic-ref --short refs/remotes/origin/HEAD
```

Work pushed to `main` in one of those deploys nothing and is read by nobody,
and the failure is silent — the push succeeds.

**Say which branch you measured.** Reading `git ls-files` or the working tree
tells you about your checkout, not about the repository. That mistake reported
the estate's secret scanning as 35/35 when it was 15/35, and was then made a
second time, in a different tool, by a different agent, four hours later. If a
claim is about what ships, read the ref.

**Re-vendor before you trust a vendored change.** Files named `vendor-*.mjs`
are copies of a package in flashyos. Changing the source does nothing here
until the copy is replaced, and a stale copy does not fail — it disagrees,
silently, about whichever field somebody has just changed.
`node tools/estate-hygiene.mjs` in flashyos reports every copy that has
drifted.

**No secret in a file, a repo, or an artifact.** Secret Manager only. A
committed credential is burned the moment it lands and stays burned after the
file is deleted, because history keeps it — removal is not rotation.

**The licence is declared once**, in `tools/estate-licences.mjs` in flashyos,
along with the copyright holder. Do not decide a repository's licence inside
that repository. Client work is never open-licensed: the grant is not ours to
make.

**A generated file is regenerated, never hand-edited.** `shiplog.fragment.json`,
`backlog.fragment.json`, built `public/` directories and lockfiles are outputs.
Editing one is a change that the next run silently discards.

**Report what happened, including when it is worse than expected.** A number
somebody assumed is worth less than a number somebody measured, and a
measurement nobody checked is an opinion with a progress bar.
<!-- /estate:house-rules -->
