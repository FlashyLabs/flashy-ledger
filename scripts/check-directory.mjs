#!/usr/bin/env node
// Validates this repository's directory fragment, in this repository.
//
// The estate-wide merge catches contested authority and dangling references
// across repositories. It cannot tell you *which* repository caused them, and
// it runs somewhere else. This runs here, on every build, and fails at the
// point the mistake is made.
//
//   node scripts/check-directory.mjs [fragment.json] [--external id ...]
//
// `--external` declares an id this fragment may reference but does not define,
// because another repository is the authority for it. Anything else must
// resolve locally.
//
// Dependency-free on purpose: a validator that needs an install is a validator
// that gets skipped. Vendored from @flashyos/directory — keep the copies
// identical and pass repository-specific values as flags, never by editing.
import { readFileSync, existsSync } from 'node:fs'

const KINDS = {
  Organization: 'org', Person: 'person', Agent: 'agent', Property: 'prop',
  Place: 'place', Event: 'event', Standard: 'std', Credential: 'cred',
  Claim: 'claim', Instrument: 'inst', Transaction: 'txn', Work: 'work', Source: 'src',
}
const EDGES = new Set([
  'owns', 'holds', 'operates', 'accountableFor', 'declares', 'delegatedTo',
  'defines', 'cites', 'convenes', 'spokeAt', 'issued', 'settled', 'supersededBy',
  'publishes', 'engaged', 'controls', 'dependsOn',
])
const ID = /^[a-z]+\/[a-z0-9][a-z0-9._-]*$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

// What each edge type must carry beyond the provenance envelope. A mirror of
// EDGE_REQUIRES in @flashyos/directory, which is where it is declared.
//
// It is a mirror rather than an import because this file has to run before
// `npm install`, in repositories with no `package.json` at all. That is the
// same trade the vendored charter checker makes, and it failed the same way:
// eleven identical copies agreed with each other and disagreed with the spec,
// silently, because nothing compared them. `tools/vendored-directory.test.mjs`
// in flashyos runs both over the same fragments and fails on any disagreement
// about the verdict.
//
// Until this table existed, three types had hand-written blocks and thirteen
// had nothing. A census of the estate's 485 published edges found 48 that
// would have failed it.
const REQUIRES = {
  owns: ['pct', 'instrument', 'since'],
  engaged: ['basis', 'since'],
  // The version range is the whole fact; see @flashyos/directory's EDGE_TYPES.
  dependsOn: ['range'],
  controls: ['basis', 'since'],
  holds: [],
  operates: [],
  accountableFor: [],
  declares: [],
  delegatedTo: ['scope'],
  defines: [],
  cites: [],
  convenes: [],
  spokeAt: ['year'],
  issued: ['date'],
  settled: ['sealed'],
  publishes: [],
  supersededBy: ['reason'],
}

// Required only when the target carries this prefix. One entry, and the
// estate's own data is what settled it: 88 `declares` edges name an agent and
// every one carries a role; 43 name a machine surface and none do, because
// "the role under which this org declares its backlog surface" is not a
// sentence. Same treatment `owns.since` gets, for the same reason.
const REQUIRED_WHEN_TO = { declares: { agent: ['role'] } }

const missingRequired = (e) => [
  ...(REQUIRES[e.type] ?? []),
  ...(REQUIRED_WHEN_TO[e.type]?.[String(e.to ?? '').split('/')[0]] ?? []),
].filter((k) => e[k] === undefined || e[k] === null || e[k] === '')

const argv = process.argv.slice(2)
const externals = new Set()

// Ids the emitter says it references and another repository defines.
//
// Read from `directory.externals.json` beside the fragment rather than passed
// as `--external` flags. A flag list lives in a CI invocation and a package
// script, and it stops covering a surface the day one is added — silently,
// because an unresolved endpoint that nobody passes a flag for looks the same
// as one somebody deliberately allowed. The emitter knows what it borrowed;
// this reads what the emitter wrote.
try {
  const declared = JSON.parse(readFileSync(new URL('../directory.externals.json', import.meta.url), 'utf8'))
  for (const id of declared.ids ?? []) externals.add(id)
} catch {
  // Absent is fine: a fragment that borrows nothing needs no file.
}

const positional = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--external') externals.add(argv[++i])
  else positional.push(argv[i])
}
const path = positional[0] ?? 'directory.fragment.json'
if (!existsSync(path)) {
  console.error(`  no fragment at ${path} — run the emitter first`)
  process.exit(2)
}

const f = JSON.parse(readFileSync(path, 'utf8'))
const problems = []
const bad = (code, subject, message) => problems.push({ code, subject, message })
const key = (e) => `${e.from}·${e.type}·${e.to}`

if (f.directory !== '0.1') bad('bad-version', '', `fragment declares directory "${f.directory}"`)
if (!f.source?.trim()) bad('no-source', '', 'fragment does not say who emitted it')
if (!DATE.test(f.generated ?? '')) bad('bad-generated', '', `generated "${f.generated}" is not a date`)

const provenance = (r, at) => {
  if (!DATE.test(r.asserted ?? '')) bad('bad-asserted', at, `asserted "${r.asserted}" is not a date`)
  if (!DATE.test(r.expires ?? '')) bad('bad-expires', at, `expires "${r.expires}" is not a date`)
  if (DATE.test(r.asserted ?? '') && DATE.test(r.expires ?? '') && r.expires <= r.asserted)
    bad('expires-before-asserted', at, `expires ${r.expires} is not after asserted ${r.asserted}`)
  if (!ID.test(r.assertedBy ?? ''))
    bad('no-asserter', at, 'every assertion names who made it')
  if (!['public', 'partner', 'private'].includes(r.visibility))
    bad('bad-visibility', at, `unknown visibility "${r.visibility}"`)
}

const ids = new Set()
for (const n of f.nodes ?? []) {
  const at = n.id ?? '(no id)'
  if (ids.has(n.id)) bad('duplicate-id', at, 'id emitted twice')
  ids.add(n.id)
  if (!ID.test(n.id ?? '')) bad('bad-id', at, `id is not prefix/slug`)
  if (!KINDS[n.kind]) bad('bad-kind', at, `unknown kind "${n.kind}"`)
  else if (n.id && KINDS[n.kind] !== n.id.split('/')[0])
    bad('prefix-mismatch', at, `kind ${n.kind} requires prefix "${KINDS[n.kind]}/"`)
  if (!n.name?.trim()) bad('no-name', at, 'node has no name')
  provenance(n, at)
}

const defined = new Map()
const accountable = new Set()
for (const e of f.edges ?? []) {
  const at = key(e)
  if (!EDGES.has(e.type)) bad('bad-edge-type', at, `unknown edge type "${e.type}"`)
  for (const end of ['from', 'to']) {
    const v = e[end]
    if (!ID.test(v ?? '')) { bad('bad-endpoint', at, `${end} "${v}" is not an id`); continue }
    if (!ids.has(v) && !externals.has(v))
      bad('unresolved-endpoint', at,
        `${end} "${v}" is neither emitted here nor declared with --external`)
  }
  provenance(e, at)
  if (e.type === 'defines') {
    if (defined.has(e.to)) bad('contested-claim', e.to, `${defined.get(e.to)} and ${e.from} both define it`)
    defined.set(e.to, e.from)
  }
  if (e.type === 'accountableFor') accountable.add(e.to)
  for (const k of missingRequired(e)) bad(`${e.type}-no-${k}`, at, `${e.type} requires ${k}`)
  if (e.type === 'owns') {
    // The table says pct must be present; only this says it is a percentage.
    if (e.pct !== undefined && (typeof e.pct !== 'number' || e.pct <= 0 || e.pct > 100))
      bad('owns-bad-pct', at, 'owns requires pct in (0,100]')
    if (e.visibility === 'public')
      bad('owns-public', at, 'ownership is public — confirm this is deliberate')
  }
  if (e.type === 'controls') {
    // The inverse of `owns` on every axis, which is the point of having both.
    // `owns` is a quantum and defaults to private; this is a structural fact
    // and is public by design, because a control relationship nobody outside
    // can see is not a structure. A basis is required for the same reason
    // `engaged` requires one: "controls" alone is an org chart drawn by
    // whoever drew it.
    if (e.pct !== undefined)
      bad('controls-has-pct', at, 'controls never carries a percentage — a caller disclosing a quantum wants owns')
    if (e.visibility !== 'public')
      bad('controls-not-public', at, 'controls is public by design; a private control claim is an assertion nobody can check')
  }
  if (e.type === 'holds' && (typeof e.qty !== 'number' || !e.unit))
    bad('holds-no-qty', at, 'holds requires qty and unit')  // shape, not presence
}

for (const n of f.nodes ?? [])
  if (n.kind === 'Organization' && !accountable.has(n.id))
    bad('no-accountable-human', n.id, 'no accountableFor edge — every organisation names a human')

// Sorted output means two builds of the same data produce no diff.
const sorted = [...(f.nodes ?? [])].map(n => n.id).sort((a, b) => a.localeCompare(b))
if (JSON.stringify((f.nodes ?? []).map(n => n.id)) !== JSON.stringify(sorted))
  bad('unsorted', '', 'nodes are not sorted by id — the emitter is not deterministic')

for (const p of problems)
  console.error(`  ${p.code}  ${p.subject}\n      ${p.message}`)

const n = (f.nodes ?? []).length, m = (f.edges ?? []).length
console.log(`\n  ${f.source} — ${n} nodes · ${m} edges · ${problems.length} problem(s)\n`)
process.exit(problems.length ? 1 : 0)
