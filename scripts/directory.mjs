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

for (const r of charter.roles) {
  const agent = node('Agent', 'agent', `${charter.slug}-${r.name}`, r.name, { description: r.purpose })
  edge('declares', ORG, agent, { role: r.name, scope: r.capabilities ?? [] })
}

// What this repository is additionally the authority for.
// The machines that sign this repository's records.
//
// Declared because they already sign them: every sealed entry and every
// fragment carries `assertedBy: agent/<slug>-ci`, and until 2026-08-30 that
// was an id nothing in the estate defined — 2,478 edges across thirty
// properties citing an agent that formally did not exist. An `assertedBy`
// naming an id nothing declares is a citation to nothing: it reads as
// provenance and carries none, which is worse than leaving the field empty.
//
// Not a charter role. A role is a governance label the org answers for and it
// is rendered into the handshake's advertised capabilities — declaring "ci"
// there would tell the network this org does continuous integration for
// people. An emitter is a machine the org operates, which is what `operates`
// is for. `@flashyos/directory`'s `declareEmitters` is the canonical form;
// this is inlined because the template stays dependency-free by design, and
// `tools/emitter-declaration.test.mjs` in flashyos asserts the two agree.
const CI = node('Agent', 'agent', `${charter.slug}-ci`, 'Record emitter', {
  description:
    `The workflow that derives and seals this repository's record. It emits ` +
    `shipped/1 and backlog/1 on the default branch and signs each entry as ` +
    `agent/${charter.slug}-ci.`,
})
edge('operates', ORG, CI, { scope: ['shipped/1', 'backlog/1'] })

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
