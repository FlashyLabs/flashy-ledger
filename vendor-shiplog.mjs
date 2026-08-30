#!/usr/bin/env node
// A shiplog for a repository that has no package.json.
//
// This is the plug-and-play surface, and it is the one that decides whether
// `shipped/1` is a standard or a thing one estate does. Two of the
// repositories here are dependency-free static builders and the portfolio
// companies most likely to adopt this are the least likely to want an npm
// install to do it. So: copy this file in, run it with node, get a sealed,
// valid fragment derived from the history the repository already has.
//
//   node vendor-shiplog.mjs emit [--since 2026-01-01] [--out shiplog.fragment.json]
//   node vendor-shiplog.mjs verify <fragment.json>
//
// Configure once in .shiplog/config.json:
//   {
//     "source": "repo/my-repo",
//     "org": "org/my-org",
//     "assertedBy": "agent/my-ci",
//     "defaultAuthor": "person/me",
//     "authors": { "bot@example.com": "agent/my-bot" },
//     "prBase": "https://github.com/me/my-repo/pull/",
//     "branch": "main",
//     "serve": "public/.well-known/shiplog.json"
//   }
//
// `branch` is the branch the *workflow* runs on. The log itself is always
// derived from HEAD unless `rev` says otherwise — see revOf.
//
// `serve` is the path the repository actually publishes from — the difference
// between a fragment that is committed and a fragment that is *reachable*. The
// estate learned this the expensive way with its directory fragments: they
// lived at the repository root, where a Next app serves nothing, so the
// federated merge could not be assembled by anyone without a git checkout,
// which defeats the entire point of federating it.
//
// ── Two things it does not do ───────────────────────────────────────────────
//
// It does not publish. Every entry lands `private`; making the log public is a
// decision somebody takes by editing `visibility`, not a side effect of running
// a script for the first time over a decade of branch names.
//
// It reads `--first-parent`, so an entry is a *merge to the deploy branch*
// rather than every commit. A log of every keystroke is technically accurate
// and unreadable, and it turns a velocity chart into a measure of typing.
//
// `vendor.test.ts` asserts this file's canonicalisation, digest and kind
// mapping match the TypeScript package. A vendored copy that seals *almost*
// the same way produces entries that fail verification for everyone else,
// which is the worst possible failure for a record whose point is being
// checkable.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const SHIPPED_VERSION = '1'
export const SHIP_KINDS = ['feature', 'fix', 'security', 'perf', 'docs', 'infra', 'spec', 'release', 'other']

// ── Sealing: byte-identical to @flashyos/verify's canonicalStringify ────────

export function canonicalStringify(value) {
  return JSON.stringify(sortKeysDeep(value))
}
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeysDeep(value[k])]))
  return value
}
export const hashPayload = (canonical) => createHash('sha256').update(canonical, 'utf8').digest('hex')

export function canonicalEntry(entry) {
  const { digest: _ignored, ...sealed } = entry
  return canonicalStringify(sealed)
}
export const seal = (entry) => ({ ...entry, digest: hashPayload(canonicalEntry(entry)) })
export function verifyEntry(entry) {
  const recomputed = hashPayload(canonicalEntry(entry))
  return { id: entry.id, ok: recomputed === entry.digest, claimed: entry.digest, recomputed }
}

// ── Deriving ────────────────────────────────────────────────────────────────

const PREFIX_KINDS = {
  feat: 'feature', feature: 'feature',
  fix: 'fix', bugfix: 'fix', hotfix: 'fix',
  security: 'security', sec: 'security',
  perf: 'perf', performance: 'perf',
  docs: 'docs', doc: 'docs',
  ci: 'infra', build: 'infra', chore: 'infra', infra: 'infra', deps: 'infra', refactor: 'infra', test: 'infra',
  spec: 'spec', rfc: 'spec',
  release: 'release',
}
const HEADER_RE = /^([a-z]+)(\([^)]*\))?(!)?:\s*(.+)$/i
const CLOSES_RE = /(?:closes|closed|fixes|backlog:)\s+(backlog\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)/gi
const PR_RE = /#(\d+)/
const INTEGRATION_MERGE_RE = /^merge (remote-tracking )?branch\b/i
const PR_MERGE_RE = /^merge pull request #\d+/i

// A merge of another branch into this line is not a ship. Sixty-five of this
// estate's first five hundred entries were these, and a reader scanning a
// changelog does not want "Merge branch 'main'" thirty times.
export const isIntegrationMerge = (subject) => INTEGRATION_MERGE_RE.test((subject ?? '').trim())
export const isPullRequestMerge = (subject) => PR_MERGE_RE.test((subject ?? '').trim())

// `Phase 3: gate mesh reporting`, `XP-7: the public Hunter Record page`. The
// verb that says what happened is on the far side of the colon. Capped so a
// sentence containing a colon is not mistaken for a prefix.
export const withoutPrefix = (subject) => {
  const m = /^[^:]{1,28}:\s*(.+)$/.exec((subject ?? '').trim())
  return m ? m[1] : (subject ?? '').trim()
}

// The one mechanism that involves no reading between lines: the author says so.
export function parseKindTrailer(body) {
  const m = /^[ \t]*kind:[ \t]*([a-z]+)[ \t]*$/im.exec(body ?? '')
  const kind = m?.[1]?.toLowerCase()
  return kind && SHIP_KINDS.includes(kind) ? kind : undefined
}

// Opt-in, and that is the point: a repository that declares no lexicon still
// gets `other`, because reading a convention nobody declared is guessing.
// Ambiguous verbs sit in infra — the safe direction for an unknown is the
// column nobody quotes.
export const IMPERATIVE_LEXICON = {
  feature: 'add publish serve build give advertise join emit declare introduce create ship launch enable expose offer open adopt record show render surface teach let count answer ask send anchor fold bring merge take land start seed scaffold port promote unify consolidate stand match catch close reject refuse deny report state audit review'.split(' '),
  fix: 'fix stop repair correct prevent unbreak resolve restore guard back revert'.split(' '),
  docs: 'document write explain describe clarify note spell say recommend brief'.split(' '),
  infra: 'update bump pin move rename remove delete refactor split extract tidy drop migrate upgrade gate link point align sync make put wire carry name replace switch keep hold set use run retire require derive reconcile scope harden turn rebuild rearchitect return redeploy trigger commit route repoint absorb shuffle rank exit prune trim tighten raise lower skip allow accept rewrite revise refresh rework initial'.split(' '),
  spec: 'specify define standardise standardize'.split(' '),
  release: 'release cut tag version'.split(' '),
}

export function buildLexicon(declared) {
  const out = new Map()
  for (const [kind, verbs] of Object.entries(declared ?? {})) {
    if (!SHIP_KINDS.includes(kind)) continue
    for (const verb of verbs) {
      const clean = String(verb).trim().toLowerCase()
      if (clean && !out.has(clean)) out.set(clean, kind)
    }
  }
  return out
}

const leadingVerb = (text) => (text ?? '').trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? ''

export function parseSubject(subject, lexicon) {
  const trimmed = (subject ?? '').trim()
  const match = HEADER_RE.exec(trimmed)

  if (match) {
    const [, type, scope, bang, rest] = match
    const known = PREFIX_KINDS[type.toLowerCase()]
    if (known) {
      const scoped = scope?.slice(1, -1).toLowerCase()
      return {
        kind: scoped && PREFIX_KINDS[scoped] === 'release' ? 'release' : known,
        title: rest.trim(),
        breaking: bang === '!',
      }
    }
  }

  if (lexicon?.size) {
    for (const candidate of [trimmed, withoutPrefix(trimmed)]) {
      const kind = lexicon.get(leadingVerb(candidate))
      if (kind) return { kind, title: trimmed, breaking: false }
    }
  }

  return { kind: 'other', title: trimmed, breaking: false }
}

export function parseCloses(message) {
  return [...new Set([...(message ?? '').matchAll(CLOSES_RE)].map((m) => m[1]))]
}

export function parseGitLog(raw) {
  return raw.split('\x1e').map((r) => r.trim()).filter(Boolean).map((record) => {
    const [sha, at, authorEmail, subject, body = ''] = record.split('\x1f')
    const coAuthorEmails = [...body.matchAll(/co-authored-by:[^<]*<([^>]+)>/gi)].map((m) => m[1])
    const commit = { sha, at, authorEmail, subject: subject ?? '' }
    if (body.trim()) commit.body = body.trim()
    if (coAuthorEmails.length) commit.coAuthorEmails = coAuthorEmails
    return commit
  }).filter((c) => c.sha && c.at)
}

export function fromCommits(commits, options) {
  const repoSlug = options.repo.replace(/^repo\//, '')
  const asserted = options.asserted ?? new Date().toISOString().slice(0, 10)
  const authors = options.authors ?? {}
  const unmapped = new Set()
  const lexicon = options.lexicon
    ? buildLexicon(options.lexicon === 'imperative' ? IMPERATIVE_LEXICON : options.lexicon)
    : undefined
  const declaredKinds = options.kinds ?? {}
  const nodeFor = (email) => {
    const mapped = authors[email.toLowerCase()]
    if (mapped) return mapped
    unmapped.add(email)
    return options.defaultAuthor
  }

  const shipped = options.keepIntegrationMerges
    ? commits
    : commits.filter((c) => !isIntegrationMerge(c.subject))

  const entries = shipped.map((commit) => {
    const message = `${commit.subject}\n${commit.body ?? ''}`
    const inferred = parseSubject(commit.subject, lexicon)
    // Precedence, most authoritative first: a person's recorded decision, the
    // author's own trailer, then what can be read off the subject.
    const overridden = declaredKinds[commit.sha] ?? declaredKinds[commit.sha.slice(0, 12)]
    const declared = SHIP_KINDS.includes(overridden) ? overridden : undefined
    const kind = declared ?? parseKindTrailer(commit.body) ?? inferred.kind
    const { title, breaking } = inferred
    const by = [...new Set([commit.authorEmail, ...(commit.coAuthorEmails ?? [])].filter(Boolean).map(nodeFor))]
    const entry = {
      id: `ship/${repoSlug}/${commit.sha.slice(0, 12).toLowerCase()}`,
      repo: options.repo,
      at: commit.at,
      kind,
      title: (breaking ? `${title} (breaking)` : title).slice(0, 140),
      by: by.length ? by : [options.defaultAuthor],
      asserted,
      assertedBy: options.assertedBy,
      visibility: options.visibility ?? 'private',
    }
    const detail = (commit.body ?? '').trim()
    if (detail) entry.detail = detail.slice(0, 2000)
    const refs = { commit: commit.sha.toLowerCase() }
    const pr = options.prBase ? PR_RE.exec(commit.subject) : null
    if (pr) refs.pr = `${options.prBase}${pr[1]}`
    entry.refs = refs
    const closes = parseCloses(message)
    if (closes.length) entry.closes = closes
    return seal(entry)
  })

  return { entries, unmapped: [...unmapped].sort() }
}

/**
 * Where else this fragment has to land to be reachable over https.
 *
 * A string or a list, and never the file we just wrote — a `serve` that points
 * at the root output would truncate it to empty on some filesystems and read
 * as "the emitter deleted my changelog".
 */
/**
 * The public tier, and only it.
 *
 * `partner` is deliberately excluded from anything served without
 * authentication: a partner-tier entry behind no gate is a public entry with a
 * misleading label. The package's `view()` grants partner to a *partner*, and
 * an unauthenticated fetch is not one.
 */
export const publicView = (entries) => entries.filter((e) => e?.visibility === 'public')

export function servedPaths(config, out) {
  const declared = config?.serve
  if (!declared) return []
  const list = Array.isArray(declared) ? declared : [declared]
  return list
    .filter((p) => typeof p === 'string' && p.trim())
    .map((p) => p.trim())
    .filter((p) => join(p) !== join(out))
}

export const fragmentOf = (config, entries, generated = new Date().toISOString()) => ({
  shipped: SHIPPED_VERSION, source: config.source, org: config.org, generated, entries,
})

/**
 * Config shape → derivation options.
 *
 * The config calls it `source` because that is the *fragment's* field; the
 * derivation calls it `repo` because that is the *entry's*. Exported and
 * tested rather than inlined in the CLI, because inlining it is exactly how
 * this shipped broken the first time: every pure function had a test, the one
 * line joining them to the config had none, and the failure was an
 * undefined-property crash on the first real run.
 */
export const deriveOptionsFrom = (config) => ({ ...config, repo: config.source })

// ── CLI ─────────────────────────────────────────────────────────────────────

const CONFIG = '.shiplog/config.json'
// sha → kind, for the third of real history that is a noun phrase with no verb
// to read. A person decides once and it is written down here.
const KINDS = '.shiplog/kinds.json'
const FORMAT = '%H%x1f%aI%x1f%aE%x1f%s%x1f%b%x1e'

/**
 * Which revision the log is derived from.
 *
 * `HEAD`, and not `config.branch`. Those are two different things that were
 * briefly one: `branch` is the branch the *workflow* runs on — the remote's
 * default branch — and a checkout on a feature branch, or a clone that never
 * created a local `main`, does not have it. Reading HEAD is right in both
 * places: locally it is what you have checked out, and in CI the checkout
 * action has already put you on the branch that triggered the run.
 *
 * `rev` exists for the one case that is neither: deriving a log for a branch
 * you are not on.
 */
export const revOf = (config) => config?.rev ?? 'HEAD'

export function readGitLog({ rev = 'HEAD', since } = {}) {
  const args = ['log', '--first-parent', `--pretty=format:${FORMAT}`, rev]
  if (since) args.push(`--since=${since}`)
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function run(argv) {
  const command = argv[0] ?? 'emit'
  const flag = (name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? undefined : argv[i + 1] }

  if (command === 'verify') {
    const path = argv[1] ?? '.shiplog/../shiplog.fragment.json'
    const fragment = JSON.parse(readFileSync(path, 'utf8'))
    const broken = (fragment.entries ?? []).map(verifyEntry).filter((c) => !c.ok)
    for (const c of broken) console.error(`✗ ${c.id} claims ${c.claimed.slice(0, 12)}… hashes to ${c.recomputed.slice(0, 12)}…`)
    console.log(broken.length ? `${broken.length} broken seal(s)` : `ok — ${fragment.entries.length} seals recomputed`)
    process.exit(broken.length ? 1 : 0)
  }

  if (!existsSync(CONFIG)) throw new Error(`${CONFIG} is missing — see the header of this file for its shape`)
  const config = JSON.parse(readFileSync(CONFIG, 'utf8'))
  const raw = readGitLog({ rev: revOf(config), since: flag('since') })
  // A recorded human decision per commit, for the ones nothing can read.
  const kinds = existsSync(KINDS) ? JSON.parse(readFileSync(KINDS, 'utf8')) : {}
  const { entries, unmapped } = fromCommits(parseGitLog(raw), { ...deriveOptionsFrom(config), kinds })
  const out = flag('out') ?? 'shiplog.fragment.json'
  // The root output is the repository's own full record — every tier.
  writeFileSync(out, `${JSON.stringify(fragmentOf(config, entries), null, 2)}\n`)
  console.log(`${entries.length} entries → ${out}`)

  // The served copy is the PUBLIC PROJECTION and never the full record.
  // Written rather than copied by a workflow, so there is one implementation,
  // the two cannot be one commit apart, and the filtering is not a step
  // somebody can forget. A `serve` path carrying private entries is a
  // disclosure with a URL.
  //
  // Derived entries land private unless `visibility` says otherwise in the
  // config, so a repository that adopts this and changes nothing else
  // publishes an empty log. That is the intended first state: publishing is a
  // decision somebody takes, not a side effect of running a script over a
  // decade of branch names.
  const open = publicView(entries)
  for (const path of servedPaths(config, out)) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(fragmentOf(config, open), null, 2)}\n`)
    console.log(`${' '.repeat(String(entries.length).length)}  → ${path} (served, ${open.length} public of ${entries.length})`)
  }
  if (unmapped.length) {
    console.log(`\n${unmapped.length} unmapped author${unmapped.length === 1 ? '' : 's'} — add these to config.authors:`)
    for (const email of unmapped) console.log(`  ${email}`)
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  try { run(process.argv.slice(2)) } catch (error) { console.error(error.message); process.exit(1) }
}
