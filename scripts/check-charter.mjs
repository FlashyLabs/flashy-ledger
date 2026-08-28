#!/usr/bin/env node
// Validates this repository's AAO charter.
//
// The estate authors the AAO standard. Every charter in it was non-conformant
// until 2026-08-28 — including FlashyOS's own production charter — because
// nothing checked. This checks.
//
//   node scripts/check-charter.mjs [flashyos.roles.json]
//
// Mirrors the static half of @flashyos/aao's conformance suite, dependency-free
// so it runs before an install. The published validator remains authoritative;
// when @flashyos/agent is available, `npx @flashyos/agent conform` supersedes
// this. Vendored byte-identical across the estate — do not edit per repository.
import { readFileSync, existsSync } from 'node:fs'

const FAMILIES = ['growth', 'revenue', 'product', 'engineering', 'operations',
  'data', 'finance', 'risk', 'governance', 'support']
const TOP = new Set(['aao', 'name', 'slug', 'description', 'accountableTo',
  'escalation', 'repositories', 'roles', 'network'])
const ROLE_KEYS = new Set(['name', 'family', 'purpose', 'measure', 'capabilities',
  'humanApprovalAtOrAbove', 'worksIn'])
const IMPACT = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

const path = process.argv[2] ?? 'flashyos.roles.json'
if (!existsSync(path)) { console.error(`  no charter at ${path}`); process.exit(2) }
const c = JSON.parse(readFileSync(path, 'utf8'))
const problems = []
const bad = (at, msg) => problems.push({ at, msg })

if (c.aao !== '0.1') bad('aao', `declares "${c.aao}"`)
if (!c.name?.trim()) bad('name', 'missing')
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.slug ?? '')) bad('slug', `"${c.slug}" is not a url-safe slug`)
if (!c.description?.trim()) bad('description', 'an org with no description says nothing')

// Question five: a real, reachable human.
if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(c.accountableTo ?? ''))
  bad('accountableTo', 'must be an email — the accountable human is reachable')
if (c.accountableTo === 'you@example.com') bad('accountableTo', 'is the template placeholder')

// Anything outside the spec is carried as an explicit x- extension, never a
// bare key. This is the rule every charter in the estate broke.
for (const k of Object.keys(c))
  if (!TOP.has(k) && !k.startsWith('x-'))
    bad(k, 'not part of aao 0.1 — prefix "x-" to carry it as an explicit extension')

const repos = c.repositories ?? []
if (repos.length && repos.filter(r => r.default).length > 1)
  bad('repositories', 'at most one default repository')
const repoNames = new Set(repos.map(r => r.name))

if (!Array.isArray(c.roles) || !c.roles.length) bad('roles', 'an org with no roles is not an organization')
const names = new Set()
;(c.roles ?? []).forEach((r, i) => {
  const at = `roles[${i}]`
  if (names.has(r.name)) bad(at, `duplicate role name "${r.name}"`)
  names.add(r.name)
  // A role is a standing responsibility named for the function performed.
  if (!/^[a-z][a-z-]*$/.test(r.name ?? ''))
    bad(at, `"${r.name}" is not a plain lowercase function name`)
  if ((r.name ?? '').split('-').length > 3) bad(at, `"${r.name}" is too many words for a role name`)
  if (r.family !== undefined && !FAMILIES.includes(r.family))
    bad(`${at}.family`, `"${r.family}" is not one of the ten declared families`)
  if (!r.purpose?.trim()) bad(at, 'a role with no purpose cannot be delegated')
  // Capabilities name actions, never departments.
  for (const cap of r.capabilities ?? [])
    if (FAMILIES.includes(cap)) bad(`${at}.capabilities`, `"${cap}" names a department, not an action`)
  if (r.humanApprovalAtOrAbove !== undefined && !IMPACT.includes(r.humanApprovalAtOrAbove))
    bad(`${at}.humanApprovalAtOrAbove`, `"${r.humanApprovalAtOrAbove}" is not LOW, MEDIUM, HIGH or CRITICAL`)
  for (const w of r.worksIn ?? [])
    if (repoNames.size && !repoNames.has(w)) bad(`${at}.worksIn`, `"${w}" is not a declared repository`)
  for (const k of Object.keys(r))
    if (!ROLE_KEYS.has(k) && !k.startsWith('x-')) bad(`${at}.${k}`, 'unknown role key — prefix "x-"')
})

if (c.escalation !== undefined && !names.has(c.escalation))
  bad('escalation', `"${c.escalation}" does not name a declared role`)

for (const p of problems) console.error(`  ${p.at}: ${p.msg}`)
console.log(`\n  ${c.name ?? path} — ${(c.roles ?? []).length} role(s) · ${problems.length} problem(s)\n`)
process.exit(problems.length ? 1 : 0)
