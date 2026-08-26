import { createHash } from 'node:crypto'
import type { Entry } from './entry.js'
import { LedgerError } from './errors.js'

/**
 * The checkpoint root and the receipt.
 *
 * A content-hashed chain (see entry.ts) already makes a single ledger
 * tamper-evident to anyone holding the whole chain. A Merkle root does the
 * harder thing the Anchor Doctrine is built on: it lets a stranger who holds
 * *one* entry and a short proof — not the chain, not the database, not any
 * trust in the operator — verify that that entry is part of a batch whose root
 * was published. Publish the root to a public blockchain (Phase 2) and history
 * becomes auditable by an adversary, which is the only audit that counts.
 *
 * This module is the `root` object of the proof layer: charter → grant → entry
 * → root. It is pure and deterministic — no clock, no randomness, no I/O — so a
 * root computed on a laptop, in CI, and by a counterparty's own verifier are
 * the same root or the proof fails. That determinism is exactly what the
 * domain's lint discipline protects.
 *
 * SECOND-PREIMAGE SEPARATION
 *
 * The one classic Merkle mistake is hashing leaves and internal nodes the same
 * way: then an attacker can present an internal node's hash as if it were a
 * leaf and forge an inclusion proof for data that was never in the tree. RFC
 * 6962 fixes this by prefixing a distinct byte before hashing — 0x00 for a
 * leaf, 0x01 for a node — so the two hash spaces cannot overlap. We do the
 * same. It is also what makes promoting a lone odd node up a level safe: a
 * promoted leaf hash can never be mistaken for a node hash.
 */

const LEAF_PREFIX = Buffer.from([0x00])
const NODE_PREFIX = Buffer.from([0x01])

function digest(...parts: readonly Buffer[]): string {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part)
  return hash.digest('hex')
}

/**
 * The hash of a single leaf, domain-separated from internal nodes. The leaf
 * datum is an entry's own content hash — already a commitment to the entry —
 * so the tree commits to the entries transitively.
 */
export function leafHash(leaf: string): string {
  return digest(LEAF_PREFIX, Buffer.from(leaf, 'utf8'))
}

function nodeHash(left: string, right: string): string {
  return digest(NODE_PREFIX, Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

/**
 * Fold one level of the tree into the next: pair adjacent nodes, and carry a
 * final unpaired node up unchanged. Carrying (rather than duplicating) the odd
 * node avoids the duplicate-leaf ambiguity that the duplicate-the-last-node
 * convention is vulnerable to; the domain separation above is what makes it
 * safe.
 */
function fold(level: readonly string[]): string[] {
  const next: string[] = []
  for (let i = 0; i < level.length; i += 2) {
    const left = level[i]
    const right = level[i + 1]
    if (left === undefined) continue
    next.push(right === undefined ? left : nodeHash(left, right))
  }
  return next
}

/** Every level of the tree, leaves first and the single-node root level last. */
function levelsOf(leaves: readonly string[]): string[][] {
  const levels: string[][] = [leaves.map(leafHash)]
  let level = levels[0] ?? []
  while (level.length > 1) {
    level = fold(level)
    levels.push(level)
  }
  return levels
}

function assertNonEmpty(leaves: readonly string[]): void {
  if (leaves.length === 0) {
    throw new LedgerError(
      'EMPTY_MERKLE_TREE',
      'A Merkle root over no leaves commits to nothing and cannot be published as a checkpoint. ' +
        'Anchor a batch only once it has at least one entry.',
    )
  }
}

/**
 * The Merkle root of a batch of leaves. This is the single value a checkpoint
 * publishes; one root stands in for the whole batch, which is why the anchor
 * cost is bounded to one write per cadence rather than one per entry.
 */
export function merkleRoot(leaves: readonly string[]): string {
  assertNonEmpty(leaves)
  const levels = levelsOf(leaves)
  const top = levels[levels.length - 1] ?? []
  const root = top[0]
  if (root === undefined) {
    // Unreachable: a non-empty input always folds to exactly one node.
    throw new LedgerError('EMPTY_MERKLE_TREE', 'The tree produced no root.')
  }
  return root
}

/** One rung of an inclusion proof: a sibling hash and which side it sits on. */
export interface ProofStep {
  readonly sibling: string
  /** The side the SIBLING is on, so the verifier concatenates in the right order. */
  readonly side: 'left' | 'right'
}

/**
 * The audit receipt: everything a holder needs to prove one leaf belongs to a
 * published root, and nothing more. It reveals no other leaf — a counterparty
 * verifies their own entry's membership without seeing anyone else's.
 */
export interface InclusionProof {
  /** The leaf datum (an entry's content hash). */
  readonly leaf: string
  readonly index: number
  /** How many leaves were in the batch, so the receipt is self-describing. */
  readonly size: number
  /** Sibling hashes from the leaf up to the root, in order. */
  readonly path: readonly ProofStep[]
  readonly root: string
}

function assertIndexInRange(index: number, size: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= size) {
    throw new LedgerError(
      'MERKLE_INDEX_OUT_OF_RANGE',
      `Cannot prove leaf ${index} of a batch of ${size}: the index is not a position in the batch.`,
    )
  }
}

/**
 * Build the inclusion proof for the leaf at `index`. The proof is short —
 * logarithmic in the batch size — which is the whole economy of the thing: a
 * counterparty holds a few dozen bytes, not the ledger.
 */
export function inclusionProof(leaves: readonly string[], index: number): InclusionProof {
  assertNonEmpty(leaves)
  assertIndexInRange(index, leaves.length)

  const levels = levelsOf(leaves)
  const path: ProofStep[] = []
  let idx = index

  // Walk every level except the root: at each, record our sibling if we have
  // one (a promoted odd node has none), then rise to the parent index.
  for (let l = 0; l < levels.length - 1; l++) {
    const level = levels[l] ?? []
    const onRight = idx % 2 === 1
    const siblingIdx = onRight ? idx - 1 : idx + 1
    const sibling = level[siblingIdx]
    if (sibling !== undefined) {
      path.push({ sibling, side: onRight ? 'left' : 'right' })
    }
    idx = Math.floor(idx / 2)
  }

  const leaf = leaves[index] ?? ''
  return { leaf, index, size: leaves.length, path, root: merkleRoot(leaves) }
}

/**
 * Recompute the root from the leaf and its proof alone. Returns true when the
 * recomputed root matches the one the proof carries — which is the check a
 * holder runs against the root they read off the public chain. It touches no
 * tree and no ledger, which is the point: the verifier trusts only the math.
 */
export function verifyInclusion(proof: InclusionProof): boolean {
  let acc = leafHash(proof.leaf)
  for (const step of proof.path) {
    acc = step.side === 'left' ? nodeHash(step.sibling, acc) : nodeHash(acc, step.sibling)
  }
  return acc === proof.root
}

/**
 * The checkpoint root over a batch of ledger entries. A batch is anchored by
 * its entries' content hashes, so the root commits to every field of every
 * entry through the chain hash each already carries.
 */
export function checkpointRoot(entries: readonly Entry[]): string {
  return merkleRoot(entries.map((entry) => entry.hash))
}

/**
 * The receipt for one entry in a batch: the proof a holder keeps so they can
 * later show, to anyone, that this exact entry was part of the anchored root.
 */
export function auditReceipt(entries: readonly Entry[], index: number): InclusionProof {
  return inclusionProof(
    entries.map((entry) => entry.hash),
    index,
  )
}
