#!/usr/bin/env node
// Validates this repository's front door against frontdoor/1.
//
// Vendored: this file is byte-identical in every repository that publishes a
// door, and the canonical copy lives in @flashyos/frontdoor with a drift test
// that fails if a copy is edited or carries a repository-specific value.
//
// Dependency-free on purpose. It runs on a Next.js app, a static generator and
// a hand-written HTML site with the same `node` and no install, which is the
// only way one check covers an estate that runs four stacks.
//
//   node scripts/check-frontdoor.mjs [path]     default: public/.well-known/frontdoor.json
//                                                falls back to well-known/frontdoor.json

import { readFileSync, existsSync } from 'node:fs'

const CONTRACT = '1'
const LANES = ['capital', 'partnership', 'integrate', 'machine', 'general']
const NOT_AUTHORITY =
  'A rung buys a reply and a place in a queue. It never buys authority, money, or access. ' +
  'Publishing a file at a domain proves that someone can write to that host — it does not prove ' +
  'an organisation is who it says it is, and this door does not treat it as though it did. ' +
  'Where real authority is needed it is delegated and verified through flashyID, and the chain is checked.'

const CANDIDATES = [
  process.argv[2],
  'public/.well-known/frontdoor.json',
  'well-known/frontdoor.json',
  '.well-known/frontdoor.json',
].filter(Boolean)

const path = CANDIDATES.find(p => existsSync(p))
if (!path) {
  console.error(`\n  no door found — looked in:\n${CANDIDATES.map(p => `    ${p}`).join('\n')}\n`)
  process.exit(1)
}

let door
try {
  door = JSON.parse(readFileSync(path, 'utf8'))
} catch (e) {
  console.error(`\n  ${path} is not valid JSON: ${e.message}\n`)
  process.exit(1)
}

const problems = []
const err = m => problems.push(['error', m])
const warn = m => problems.push(['warning', m])
const isUrl = s => typeof s === 'string' && /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s)

if (door.frontdoor !== CONTRACT) err(`frontdoor must be "${CONTRACT}", got ${JSON.stringify(door.frontdoor)}`)
if (!door.property) err('a door must name the property it belongs to')
if (!door.org) err('a door must name its organisation slug')
if (!isUrl(door.endpoint)) err('endpoint must be an https url')
if (!isUrl(door.ladder)) err('ladder must be an https url a human can read')
if (!/^\d{4}-\d{2}-\d{2}$/.test(door.updated ?? '')) err('updated must be an ISO date')

// The normative paragraph. A door that drops it has quietly become a claim
// about authority, which is the one failure this contract exists to prevent.
if (door.notAuthority !== NOT_AUTHORITY)
  err('notAuthority must be carried verbatim — a door without it reads as an authorisation')

if (!Array.isArray(door.lanes) || !door.lanes.length) {
  err('a door must open at least one lane')
} else {
  const seen = new Set()
  for (const l of door.lanes) {
    if (!LANES.includes(l.id)) err(`unknown lane "${l.id}"`)
    if (seen.has(l.id)) err(`lane "${l.id}" is opened twice`)
    seen.add(l.id)
    if (l.id !== 'general' && !l.question) err(`lane "${l.id}" asks nothing — a lane with no question is a form`)
  }
}

if (!Array.isArray(door.rungs) || !door.rungs.length) {
  err('a door must publish its ladder')
} else {
  const ns = door.rungs.map(r => r.n)
  if (!ns.includes(0)) err('there is no rung 0 — a ladder with no open door is a wall')
  if (new Set(ns).size !== ns.length) err('two rungs share a number')
  for (const r of door.rungs) {
    if (!r.did || !r.owed || !r.sla) err(`rung ${r.n} does not state what was done, what is owed, and the promise`)
    if (r.n > 0 && !r.cost) warn(`rung ${r.n} does not say what it costs an applicant`)
  }
  for (const l of door.lanes ?? [])
    if (l.minRung !== undefined && !ns.includes(l.minRung))
      err(`lane "${l.id}" requires rung ${l.minRung}, which this door does not publish`)
}

const errors = problems.filter(([lvl]) => lvl === 'error')
const label = `${door.property ?? path} — ${door.lanes?.length ?? 0} lane(s) · ${door.rungs?.length ?? 0} rung(s)`
console.log(`\n  ${label} · ${problems.length} problem(s)\n`)
for (const [lvl, m] of problems) console.log(`  ${lvl === 'error' ? '✗' : '!'} ${m}`)
if (problems.length) console.log()
process.exit(errors.length ? 1 : 0)
