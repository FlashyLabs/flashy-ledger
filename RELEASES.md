# Release ledger — @flashylabs/ledger

The versions this package has declared, whether each was tagged, and whether the
publish actually landed. It exists because a package whose whole pitch is
verifiability cannot have published versions that no commit is tagged for — that
fails on the first question a serious adopter asks.

`tests/releases.test.ts` asserts the version in `package.json` has a row here, so
a bump that nobody records fails CI instead of shipping untraceably.

## What was actually measured

The roadmap said "0.7.0 and 0.8.0 shipped untraceable." Read against the git
history and the publish workflow, that was imprecise in two ways worth stating,
because the real diagnosis points at a different fix:

- **There was never a 0.7.0.** The version went `0.6.3 → 0.8.0` directly
  (commit `e52704b`, "the Merkle spec becomes the package's"). Nothing is
  missing between them; there is no such version to tag.
- **The untagged versions did not "ship untraceable" — their publishes
  failed.** `.github/workflows/publish.yml` records that every publish since the
  token change (0.6.3, 0.8.0) died with **E401 on the PUT**. `@flashylabs/ledger`
  was created by manual PAT publishes, and the package's own *Actions access
  list* — not the workflow's `permissions:` block — decides who may PUT new
  versions. `GITHUB_TOKEN` can read the package but cannot publish to it.

So the release trail is not blocked on remembering to tag. It is blocked on
registry access, which is an operator action (below). The workflow is already
correct: it verifies the pushed tag matches `package.json`, refuses to
dispatch-release an already-tagged version, and tags **only after** a successful
publish — so a failed publish never leaves a tag claiming a release that did not
happen. That is why 0.6.3 and 0.8.0 have no tag: the publishes they would have
tagged never succeeded.

## The ledger

| Version | Commit | Tagged | Publish landed | Notes |
|---|---|---|---|---|
| 0.1.0 | — | ✅ v0.1.0 | assumed | first cut |
| 0.1.1 | — | ✅ v0.1.1 | assumed | clean release tag |
| 0.1.2 | — | ✅ v0.1.2 | assumed | scope rename to @flashylabs |
| 0.2.0 | — | ✅ v0.2.0 | assumed | tenancy a boundary |
| 0.3.0 | — | ✅ v0.3.0 | assumed | experience domain |
| 0.4.0 | — | ✅ v0.4.0 | assumed | — |
| 0.5.0 | — | ✅ v0.5.0 | assumed | refuse a person-named identity |
| 0.6.0 | — | ✅ v0.6.0 | assumed | asset registry; last tagged version |
| 0.6.1 | `cdcf009` | ❌ | unverified | "the npm mirror release" |
| 0.6.2 | `a5c9012` | ❌ | unverified | "re-cut of the release that died between registries" |
| 0.6.3 | `d10f9dc` | ❌ | **failed (E401)** | "the release that goes end-to-end" |
| 0.8.0 | `e52704b` | ❌ | **failed (E401)** | current `package.json` version |

"assumed" means the tag exists and no failure is recorded — not independently
re-verified against the registry from this checkout, which cannot read the
private GitHub Packages feed offline. "unverified" means neither a tag nor a
recorded outcome settles it; 0.6.1/0.6.2 predate the recorded E401 streak, so
they may be on the registry, but this ledger does not assert what it did not
measure.

## The fix (operator, one-time)

Retroactive tagging from a checkout does not help and cannot be done here: the
remote-agent git proxy 403s tag refs, and a tag would fire `publish.yml`, which
correctly refuses because the pushed tag's version must match `package.json`
(0.8.0) — so only a `v0.8.0` tag could push, and it would re-attempt the same
failing publish. The real unblock is registry access:

1. **Package settings → Manage Actions access** → grant `FlashyLabs/flashy-ledger`
   **write**. This is the setting the E401 is actually about.
2. Or set the **`PACKAGES_TOKEN`** secret to a PAT with `write:packages`. The
   workflow already prefers it over `GITHUB_TOKEN`.
3. For the public-npm mirror, set **`NPM_TOKEN`** (read-write on `@flashylabs`).
   Until it exists the mirror step skips with a visible notice, so its absence
   never fails a release.

Then dispatch `Publish` (workflow_dispatch). It publishes `0.8.0` and, on
success, creates and pushes `v0.8.0` — the release makes the tag, so "every
release has its tag" holds going forward without anyone remembering. To backfill
`v0.6.1`/`v0.6.2` as pure provenance (no republish), a maintainer with tag-push
rights tags those commits directly; there is nothing to publish for them.

## Adding a release

Bump `package.json`, add a row here, then dispatch `Publish`. The row is not
optional: `tests/releases.test.ts` fails if `package.json`'s version has no row,
which is the check that turns "published a version nobody wrote down" from a
silent gap into a red build.
