// This repository's directory fragment.
//
// Everything the organisation and its roles imply is read from
// flashyos.roles.json, so the charter and the fragment cannot disagree.
// Below it, only what this repository is additionally the authority for.
//
// Run: node scripts/directory.mjs   →   directory.fragment.json
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const charter = JSON.parse(readFileSync(join(ROOT, 'flashyos.roles.json'), 'utf8'))

const ASSERTED = '2026-08-28'
const EXPIRES = '2027-08-28'
const BY = 'person/michael'   // defined by repo/gord-holdings; referenced here
const repo = charter.repositories?.find(r => r.default) ?? charter.repositories?.[0]
const SOURCE = `repo/${repo?.name ?? charter.slug}`

const nodes = []
const edges = []
const base = { asserted: ASSERTED, assertedBy: BY, expires: EXPIRES, visibility: 'public' }
const node = (kind, prefix, slug, name, extra = {}) => {
  const id = `${prefix}/${slug}`
  nodes.push({ ...base, id, kind, name, ...extra })
  return id
}
const edge = (type, from, to, extra = {}) => edges.push({ ...base, type, from, to, ...extra })

const PLATFORM = 'infrastructure'
const VERTICAL = 'flashy'
const PROPERTIES = []

const ORG = node('Organization', 'org', charter.slug, charter.name, {
  description: charter.description, platform: PLATFORM, vertical: VERTICAL,
})
edge('accountableFor', BY, ORG)

for (const r of charter.roles) {
  const agent = node('Agent', 'agent', `${charter.slug}-${r.name}`, r.name, { description: r.purpose })
  edge('declares', ORG, agent, { role: r.name, scope: r.capabilities ?? [] })
}

// What this repository is additionally the authority for.
// The machine that signs this repository's records.
//
// Declared because it already signs them: every sealed entry carries
// `assertedBy`, and until 2026-08-30 that named an id nothing in the estate
// defined — 2,478 edges across thirty properties citing an agent that formally
// did not exist. An `assertedBy` naming an id nothing declares is a citation to
// nothing: it reads as provenance and carries none, which is worse than leaving
// the field empty.
//
// The id is READ from `.shiplog/config.json` rather than derived from the
// charter slug. The first version of this block assumed `${charter.slug}-ci`
// and was wrong in two repositories out of ten — ClaimYour.Gold signs
// `agent/claimyour.gold-ci` against a charter slug of `claimyour-gold`, and
// dais-global signs `agent/dais-global-ci` against a slug of `dais`. Both
// declared an agent that matched nothing, which looks identical to success.
// The file that stamps the id is the only honest source for it.
//
// Not a charter role. A role is a governance label the org answers for and it
// is rendered into the handshake's advertised capabilities — declaring "ci"
// there would tell the network this org does continuous integration for other
// people. An emitter is a machine the org operates.
const shiplog = JSON.parse(readFileSync(join(ROOT, '.shiplog', 'config.json'), 'utf8'))
const CI_ID = shiplog.assertedBy ?? `agent/${charter.slug}-ci`
if (!CI_ID.startsWith('agent/'))
  throw new Error(`.shiplog/config.json agent must be an agent/<slug> id, got "${CI_ID}"`)
const CI = node('Agent', 'agent', CI_ID.slice('agent/'.length), 'Record emitter', {
  description:
    `The workflow that derives and seals this repository's record. It emits ` +
    `shipped/1 on the default branch and signs each entry as ` +
    `${CI_ID}.`,
})
edge('operates', ORG, CI, { scope: ['shipped/1'] })

// And whose authority it acts on. `operates` says the organisation runs the
// machine; it does not say who answers for what the machine does, and that is
// the fact that makes a signature mean anything. An agent acts *for* somebody,
// the somebody answers, and an agent with no stated bound is one nobody can say
// has exceeded anything.
//
// Person → agent, carrying the same scope: the shape of a Flashy ID root grant,
// whose issuer is the accountable human and whose scope a chain may only ever
// narrow. The record states the delegation; the signed assertion that enforces
// it lives in Flashy ID. Proof never moves into the record.
edge('delegatedTo', BY, CI, { scope: ['shipped/1'] })

// The second machine. `.shiplog/config.json` stamps the seal; this one stamps
// the filing, and they are different identities in published data. The estate
// declared only the first for a week, because `recordEmitter` listed
// `backlog/1` among the record emitter's formats — so everything comparing
// formats saw it named and stopped, and nothing compared the signature.
//
// The tenses are shaped differently on purpose: an item decays and is never
// sealed, an entry is sealed and never decays. Different things write them, at
// different times.
const BACKLOG_ID = JSON.parse(readFileSync(join(ROOT, '.backlog', 'config.json'), 'utf8')).agent
if (!BACKLOG_ID?.startsWith('agent/'))
  throw new Error(`.backlog/config.json agent must be an agent/<slug> id, got "${BACKLOG_ID}"`)
const BACKLOG_BOT = node('Agent', 'agent', BACKLOG_ID.slice('agent/'.length), 'Backlog emitter', {
  description:
    `The tool that files and promotes this repository's intentions. It emits ` +
    `backlog/1 and signs each item as ${BACKLOG_ID}.`,
})
edge('operates', ORG, BACKLOG_BOT, { scope: ['backlog/1'] })
edge('delegatedTo', BY, BACKLOG_BOT, { scope: ['backlog/1'] })

for (const [domain, name] of PROPERTIES) {
  const prop = node('Property', 'prop', domain, name, {
    url: `https://${domain}`, tenure: 'freehold', platform: PLATFORM, vertical: VERTICAL,
  })
  edge('operates', ORG, prop)
}

// ── The machine surfaces this property serves ───────────────────────────────
//
// Every property in the estate serves the same handful of documents and, until
// now, said nothing about them in its own record. That silence is what made the
// estate thirty graphs: a fragment that describes only its own organisation has
// no reason to name anything another repository defines, so nothing crossed a
// boundary except one person's name.
//
// A surface fixes that honestly. Serving `backlog/1` is a fact about this
// repository, the format belongs to flashyos, and `cites` is the edge for
// referencing something somebody else authored — which makes each of these a
// real join rather than a manufactured one.
//
// Detected from disk rather than listed. A hand-kept list claims a surface the
// day somebody deletes the file, and a declared surface that cannot be fetched
// is worse than an undeclared one: it is a promise in the record with nothing
// behind it.
const SURFACE_PATHS = [
  ['backlog/1', 'backlog.json', ['public/.well-known/backlog.json']],
  ['shipped/1', 'shiplog.json', ['public/.well-known/shiplog.json']],
  ['checkpoint/1', 'checkpoint.json', ['public/.well-known/checkpoint.json']],
  ['flashyos/1', 'flashyos.json', ['public/.well-known/flashyos.json', 'well-known/flashyos.json', 'src/app/.well-known/flashyos.json']],
  ['aao/0.1', 'flashyos-charter.json', ['public/.well-known/flashyos-charter.json', 'src/app/.well-known/flashyos-charter.json']],
]
const SURFACE_HOST = PROPERTIES[0]?.[0] ?? PROPERTIES[0]?.domain ?? charter.slug
const surfaceExternals = []
for (const [profile, served, candidates] of SURFACE_PATHS) {
  if (!candidates.some((c) => existsSync(join(ROOT, c)))) continue
  const slug = profile.replace(/[^a-z0-9]+/g, '-')
  const src = node('Source', 'src', `${charter.slug}-${slug}`, `${profile} — ${charter.slug}`, {
    url: `https://${SURFACE_HOST}/.well-known/${served}`,
    description: `The ${profile} surface this organisation serves.`,
  })
  edge('declares', ORG, src)
  // A citation, never a definition. Serving a standard is not authoring it,
  // and asserting a definition of somebody else's standard is exactly what the
  // federation rules forbid.
  edge('cites', src, `std/${slug}`)
  surfaceExternals.push(`std/${slug}`)
}

writeFileSync(
  join(ROOT, 'directory.externals.json'),
  `${JSON.stringify(
    {
      '//': 'Generated by scripts/directory.mjs. Ids this fragment references and another repository is the authority for.',
      // `BY` too: the person accountable for this organisation is declared by
      // gord-holdings, which is the authority for accountability across the
      // estate. Referencing them is the point; defining them here would be a
      // second authority for one person.
      ids: [...new Set([...surfaceExternals, BY])].sort(),
    },
    null,
    1,
  )}\n`,
)

const fragment = {
  directory: '0.1', source: SOURCE, generated: ASSERTED,
  nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
  edges: edges.sort((a, b) =>
    `${a.from}·${a.type}·${a.to}`.localeCompare(`${b.from}·${b.type}·${b.to}`)),
}
writeFileSync(join(ROOT, 'directory.fragment.json'), JSON.stringify(fragment, null, 1) + '\n')
console.log(`${SOURCE} — ${fragment.nodes.length} nodes · ${fragment.edges.length} edges`)
export default fragment
