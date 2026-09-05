// This repository's directory fragment.
//
// Everything the organisation and its roles imply is read from
// flashyos.roles.json, so the charter and the fragment cannot disagree.
// Below it, only what this repository is additionally the authority for.
//
// Run: node scripts/directory.mjs   →   directory.fragment.json
import { readFileSync, writeFileSync } from 'node:fs'
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

// ── The two machines this repository operates ───────────────────────────────
//
// An `assertedBy` naming an id nothing declares is a citation to nothing. This
// repository signed every sealed entry and every filed item as an agent its own
// fragment did not define, so 100% of its record-level provenance pointed at
// identities that formally did not exist.
//
// The id is READ from the config that stamps it, never derived from the charter
// slug. The first estate-wide roll-out assumed `${charter.slug}-ci` and was
// wrong in two repositories out of ten — ClaimYour.Gold signs
// `agent/claimyour.gold-ci` against a charter slug of `claimyour-gold` and
// dais-global signs `agent/dais-global-ci` against a slug of `dais`. A
// declared agent matching no signature anywhere looks identical to success
// from every structural check.
//
// Not a charter role. A role is a governance label the org answers for and it
// is rendered into the handshake's advertised capabilities — declaring "ci"
// there would tell the network this org does continuous integration for other
// people. An emitter is a machine the org operates.
const shiplog = JSON.parse(readFileSync(join(ROOT, '.shiplog', 'config.json'), 'utf8'))
const CI_ID = shiplog.assertedBy
if (!CI_ID?.startsWith('agent/'))
  throw new Error(`.shiplog/config.json assertedBy must be an agent/<slug> id, got "${CI_ID}"`)
const CI = node('Agent', 'agent', CI_ID.slice('agent/'.length), 'Record emitter', {
  description:
    `The workflow that derives and seals this repository's record. It emits ` +
    `shipped/1 on the default branch and signs each entry as ${CI_ID}.`,
})
edge('operates', ORG, CI, { scope: ['shipped/1'] })

// And whose authority it acts on. `operates` says the organisation runs the
// machine; it does not say who answers for what the machine does, and that is
// the fact that makes a signature mean anything. An agent acts *for* somebody,
// the somebody answers, and an agent with no stated bound is one nobody can say
// has exceeded anything.
edge('delegatedTo', BY, CI, { scope: ['shipped/1'] })

// The second machine. `.shiplog/config.json` stamps the seal; `.backlog/`
// stamps the filing, and they are different identities in published data. The
// estate declared only the first for a week, because `recordEmitter` lists
// `backlog/1` among the record emitter's formats — so everything comparing
// formats saw the tense covered and stopped, and nothing compared signatures.
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

for (const r of charter.roles) {
  const agent = node('Agent', 'agent', `${charter.slug}-${r.name}`, r.name, { description: r.purpose })
  edge('declares', ORG, agent, { role: r.name, scope: r.capabilities ?? [] })
}

// What this repository is additionally the authority for.
for (const [domain, name] of PROPERTIES) {
  const prop = node('Property', 'prop', domain, name, {
    url: `https://${domain}`, tenure: 'freehold', platform: PLATFORM, vertical: VERTICAL,
  })
  edge('operates', ORG, prop)
}

const fragment = {
  directory: '0.1', source: SOURCE, generated: ASSERTED,
  nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
  edges: edges.sort((a, b) =>
    `${a.from}·${a.type}·${a.to}`.localeCompare(`${b.from}·${b.type}·${b.to}`)),
}
writeFileSync(join(ROOT, 'directory.fragment.json'), JSON.stringify(fragment, null, 1) + '\n')
console.log(`${SOURCE} — ${fragment.nodes.length} nodes · ${fragment.edges.length} edges`)
export default fragment
