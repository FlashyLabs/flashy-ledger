#!/usr/bin/env node
// checkpoint/1 — a Merkle tree head over what this repository already seals.
//
//   node vendor-checkpoint.mjs emit                    write checkpoint.json
//   node vendor-checkpoint.mjs verify checkpoint.json  recompute and compare
//   node vendor-checkpoint.mjs prove <claim-id>        an inclusion proof
//
// ── Why this file exists ────────────────────────────────────────────────────
//
// It imports nothing but `node:` builtins and is copied whole into whichever
// repository adopts the format. Two repositories in this estate have no
// package.json at all, and the companies most likely to want a verifiable
// record are the least likely to want a toolchain. A format that needs an npm
// install to emit is a format that does not travel.
//
// ── What a head here does and does not prove ────────────────────────────────
//
// Does: anyone holding the fragments can recompute the root and see whether it
// matches. That catches accident, drift, and a fragment edited after the fact.
//
// Does not: stop a determined publisher. This host computes the root, publishes
// the root, and holds the data — so it can recompute and republish at will. The
// properties that would fix that are consistency proofs between successive
// heads and cosigning by a witness who is not us. Neither is here yet, and the
// head carries no signature rather than a self-issued one that would imply
// otherwise.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const CONFIG = '.checkpoint/config.json'
const OUT = 'checkpoint.json'

// ── RFC 6962 ────────────────────────────────────────────────────────────────
// The 0x00 / 0x01 prefixes are not decoration. Without them a leaf whose data
// is two concatenated hashes is indistinguishable from the interior node over
// those hashes, and an attacker can present an interior node as a leaf to prove
// the inclusion of something never added.

const EMPTY_ROOT = createHash('sha256').update(Buffer.alloc(0)).digest('hex')
const hx = (s) => Buffer.from(s, 'hex')

const leafHash = (d) => createHash('sha256').update(Buffer.from([0x00])).update(hx(d)).digest('hex')
const nodeHash = (l, r) => createHash('sha256').update(Buffer.from([0x01])).update(hx(l)).update(hx(r)).digest('hex')

function splitPoint(n) {
  let k = 1
  while (k * 2 < n) k *= 2
  return k
}

function mth(leaves) {
  if (leaves.length === 0) return EMPTY_ROOT
  if (leaves.length === 1) return leaves[0]
  const k = splitPoint(leaves.length)
  return nodeHash(mth(leaves.slice(0, k)), mth(leaves.slice(k)))
}

const merkleRoot = (digests) => mth(digests.map(leafHash))

function inclusionProof(digests, index) {
  const path = (leaves, m) => {
    if (leaves.length === 1) return []
    const k = splitPoint(leaves.length)
    return m < k
      ? [...path(leaves.slice(0, k), m), mth(leaves.slice(k))]
      : [...path(leaves.slice(k), m - k), mth(leaves.slice(0, k))]
  }
  return path(digests.map(leafHash), index)
}

function verifyInclusion(digest, index, size, proof, root) {
  if (index < 0 || index >= size) return false
  const goRight = []
  let i = index
  let n = size
  while (n > 1) {
    const k = splitPoint(n)
    if (i < k) { goRight.push(false); n = k } else { goRight.push(true); i -= k; n -= k }
  }
  if (proof.length !== goRight.length) return false
  let hash = leafHash(digest)
  for (let s = 0; s < proof.length; s++) {
    hash = goRight[goRight.length - 1 - s] ? nodeHash(proof[s], hash) : nodeHash(hash, proof[s])
  }
  return hash === root
}

// ── Claims ──────────────────────────────────────────────────────────────────
// Assertions, not activity. A page rebuild is not a claim anybody will dispute.
//
// `backlog/1` is absent and cannot be added: an item decays and is never
// sealed, so it carries no digest to commit to. A tree can only cover the past
// tense. Directory records carry no digest yet but could reasonably be sealed
// later, so they are listed and simply contribute nothing until they are.
const SOURCES = [
  ['entries', 'shipped'],
  ['assertions', 'directory'],
  ['nodes', 'directory'],
  ['edges', 'directory'],
]

function claimsOf(fragments) {
  const found = new Map()
  for (const fragment of fragments) {
    if (!fragment || typeof fragment !== 'object') continue
    for (const [key, kind] of SOURCES) {
      const list = fragment[key]
      if (!Array.isArray(list)) continue
      for (const r of list) {
        // Unsealed records are skipped, never hashed as a blank — a tree that
        // exists to prove sealing must not contain something unsealed.
        if (!r || !r.id || !r.digest) continue
        if (!found.has(r.id)) found.set(r.id, { id: r.id, digest: r.digest, kind })
      }
    }
  }
  // Sorted by id so the root is a pure function of the claims: two people with
  // the same fragments must get the same tree.
  return [...found.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// ── Runtime ─────────────────────────────────────────────────────────────────

/**
 * Read a declared fragment, or fail loudly.
 *
 * This returned null on any error, which made an unparseable fragment
 * indistinguishable from an absent one: the head was built over the claims it
 * could read and printed `ok`. On 2026-08-30 a rebase left conflict markers in
 * a shipped/1 fragment, and this emitter answered "0 claims, root recomputed
 * and every leaf proved" — a valid-looking head over nothing, for a repository
 * with twenty-four sealed entries.
 *
 * Absent is a fact the caller reports. Present-and-broken is an error, because
 * the alternative is a root that silently stops covering the record.
 */
const readJson = (p) => {
  let text
  try {
    text = readFileSync(p, 'utf8')
  } catch {
    return null
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    console.error(`${p} is not valid JSON — refusing to build a head that silently omits it`)
    console.error(`  ${error.message}`)
    process.exit(1)
  }
}

function loadConfig() {
  const config = readJson(CONFIG)
  if (!config) {
    console.error(`no ${CONFIG}. Create one:\n  { "origin": "repo/your-repo", "fragments": ["shiplog.fragment.json"] }`)
    process.exit(1)
  }
  return config
}

function gather(config) {
  const paths = config.fragments ?? ['shiplog.fragment.json', 'directory.fragment.json']
  const present = paths.filter((p) => existsSync(p))
  const missing = paths.filter((p) => !existsSync(p))
  return { claims: claimsOf(present.map(readJson)), present, missing }
}

function buildHead(config, claims) {
  const digests = claims.map((c) => c.digest)
  const counts = {}
  for (const c of claims) counts[c.kind] = (counts[c.kind] ?? 0) + 1
  const head = {
    checkpoint: '1',
    origin: config.origin,
    size: digests.length,
    root: digests.length ? merkleRoot(digests) : EMPTY_ROOT,
    at: new Date().toISOString(),
  }
  if (claims.length) head.counts = counts
  return head
}

const write = (p, body) => {
  mkdirSync(dirname(p) === '' ? '.' : dirname(p), { recursive: true })
  writeFileSync(p, `${JSON.stringify(body, null, 2)}\n`)
}

const command = process.argv[2]

if (command === 'emit') {
  const config = loadConfig()
  const { claims, present, missing } = gather(config)
  const head = buildHead(config, claims)
  write(OUT, head)
  if (config.serve) write(config.serve, head)

  console.log(`${head.size} claims → ${OUT}`)
  console.log(`  root ${head.root}`)
  for (const [kind, n] of Object.entries(head.counts ?? {})) console.log(`  ${kind.padEnd(12)} ${n}`)
  // Named rather than skipped silently: a head over three fragments when there
  // should have been four is a different root, and the reader must see which.
  if (missing.length) console.log(`\nnot found, so not committed to: ${missing.join(', ')}`)
  if (!present.length) console.log('\nno fragments found — this head commits to nothing')
  if (config.serve) console.log(`\nserved at ${config.serve}`)
  process.exit(0)
}

if (command === 'verify') {
  const file = process.argv[3] ?? OUT
  const head = readJson(file)
  if (!head) { console.error(`cannot read ${file}`); process.exit(1) }
  const config = loadConfig()
  const { claims } = gather(config)
  const rebuilt = buildHead(config, claims)

  if (rebuilt.root !== head.root || rebuilt.size !== head.size) {
    console.error(`MISMATCH — the head does not describe these fragments`)
    console.error(`  published  size ${head.size}  root ${head.root}`)
    console.error(`  recomputed size ${rebuilt.size}  root ${rebuilt.root}`)
    process.exit(1)
  }
  // Every leaf, not a sample. The cost is negligible at this size and a
  // spot-check would miss exactly the one leaf somebody tampered with.
  const digests = claims.map((c) => c.digest)
  for (let i = 0; i < digests.length; i++) {
    if (!verifyInclusion(digests[i], i, digests.length, inclusionProof(digests, i), head.root)) {
      console.error(`leaf ${i} (${claims[i].id}) does not prove against the root`)
      process.exit(1)
    }
  }
  console.log(`ok — ${head.size} claims, root recomputed and every leaf proved`)
  process.exit(0)
}

if (command === 'prove') {
  const id = process.argv[3]
  if (!id) { console.error('usage: node vendor-checkpoint.mjs prove <claim-id>'); process.exit(1) }
  const config = loadConfig()
  const { claims } = gather(config)
  const index = claims.findIndex((c) => c.id === id)
  if (index < 0) { console.error(`no claim ${id} in this tree`); process.exit(1) }
  const digests = claims.map((c) => c.digest)
  console.log(JSON.stringify({
    checkpoint: '1',
    origin: config.origin,
    id,
    digest: digests[index],
    index,
    size: digests.length,
    root: merkleRoot(digests),
    path: inclusionProof(digests, index),
  }, null, 2))
  process.exit(0)
}

console.log(`checkpoint/1 — a Merkle tree head over what this repository seals

  node vendor-checkpoint.mjs emit                    write ${OUT}
  node vendor-checkpoint.mjs verify [file]           recompute and compare
  node vendor-checkpoint.mjs prove <claim-id>        an inclusion proof

The head is unsigned. Anyone with the fragments can recompute the root, which
catches drift and after-the-fact edits. It does not stop a publisher who holds
both the data and the root — that needs consistency proofs and an outside
witness, and neither exists yet.`)
process.exit(command ? 1 : 0)
