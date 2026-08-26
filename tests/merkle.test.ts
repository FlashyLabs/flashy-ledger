import { describe, expect, it } from 'vitest'
import {
  LedgerError,
  auditReceipt,
  checkpointRoot,
  ZERO,
  decodeReceipt,
  encodeReceipt,
  fromDecimal,
  inclusionProof,
  leafHash,
  merkleRoot,
  post,
  verifyInclusion,
  type Asset,
  type Entry,
  type LedgerState,
  type ProposedEntry,
} from '../src/index.js'

/**
 * The checkpoint root and the receipt.
 *
 * A content-hashed chain already lets someone with the whole chain detect a
 * tampered entry. The property these tests hold to is the stronger one the
 * Anchor Doctrine sells: someone holding a single leaf and a short proof — and
 * neither the chain, the database, nor any trust in the operator — can verify
 * that leaf belongs to a published root, and cannot forge membership for a leaf
 * that does not.
 */

const HASHES = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `entry-hash-${i}`)

describe('merkleRoot', () => {
  it('is deterministic: the same leaves always give the same root', () => {
    expect(merkleRoot(HASHES(5))).toBe(merkleRoot(HASHES(5)))
  })

  it('changes when any leaf changes', () => {
    const before = merkleRoot(['a', 'b', 'c', 'd'])
    const after = merkleRoot(['a', 'b', 'c', 'D'])
    expect(after).not.toBe(before)
  })

  it('is order-sensitive: reordering leaves changes the root', () => {
    expect(merkleRoot(['a', 'b'])).not.toBe(merkleRoot(['b', 'a']))
  })

  it('a one-leaf tree roots at that leaf hash', () => {
    expect(merkleRoot(['solo'])).toBe(leafHash('solo'))
  })

  it('produces a 32-byte (64 hex char) root', () => {
    expect(merkleRoot(HASHES(7))).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses an empty batch', () => {
    expect(() => merkleRoot([])).toThrow(LedgerError)
    try {
      merkleRoot([])
    } catch (err) {
      expect((err as LedgerError).code).toBe('EMPTY_MERKLE_TREE')
    }
  })

  it('handles odd leaf counts by carrying the last node up', () => {
    // Three leaves must still produce a single stable root, not throw or drop
    // the odd one.
    const root = merkleRoot(['a', 'b', 'c'])
    expect(root).toMatch(/^[0-9a-f]{64}$/)
    // And the odd leaf genuinely participates: changing it moves the root.
    expect(merkleRoot(['a', 'b', 'C'])).not.toBe(root)
  })
})

describe('second-preimage separation', () => {
  it('a leaf hash is not the same as a node hash of the same material', () => {
    // If leaves and nodes were hashed alike, an attacker could pass an internal
    // node off as a leaf. Domain separation (0x00 vs 0x01 prefix) makes the two
    // spaces disjoint: the root of two leaves is never equal to any single
    // leaf hash.
    const root = merkleRoot(['x', 'y'])
    expect(root).not.toBe(leafHash('x'))
    expect(root).not.toBe(leafHash('y'))
  })
})

describe('inclusionProof / verifyInclusion', () => {
  it('every leaf in a batch verifies against the root', () => {
    const leaves = HASHES(9) // deliberately odd, to exercise promoted nodes
    for (let i = 0; i < leaves.length; i++) {
      const proof = inclusionProof(leaves, i)
      expect(proof.root).toBe(merkleRoot(leaves))
      expect(proof.leaf).toBe(leaves[i])
      expect(proof.size).toBe(leaves.length)
      expect(verifyInclusion(proof)).toBe(true)
    }
  })

  it('verifies for batch sizes from 1 to 16', () => {
    for (let n = 1; n <= 16; n++) {
      const leaves = HASHES(n)
      for (let i = 0; i < n; i++) {
        expect(verifyInclusion(inclusionProof(leaves, i))).toBe(true)
      }
    }
  })

  it('the proof is logarithmic in the batch size', () => {
    // 1000 leaves — a holder carries ~10 sibling hashes, not the batch.
    const proof = inclusionProof(HASHES(1000), 500)
    expect(proof.path.length).toBeLessThanOrEqual(10)
    expect(verifyInclusion(proof)).toBe(true)
  })

  it('rejects a proof whose leaf was swapped', () => {
    const proof = inclusionProof(HASHES(8), 3)
    expect(verifyInclusion({ ...proof, leaf: 'not-the-leaf' })).toBe(false)
  })

  it('rejects a proof whose root was swapped', () => {
    const proof = inclusionProof(HASHES(8), 3)
    expect(verifyInclusion({ ...proof, root: leafHash('forged') })).toBe(false)
  })

  it('rejects a proof with a tampered sibling', () => {
    const proof = inclusionProof(HASHES(8), 3)
    const [first, ...rest] = proof.path
    expect(first).toBeDefined()
    if (!first) return
    const tampered = { ...proof, path: [{ ...first, sibling: leafHash('evil') }, ...rest] }
    expect(verifyInclusion(tampered)).toBe(false)
  })

  it('rejects a proof with a flipped side', () => {
    // A batch of 2 has one proof step; flipping which side the sibling is on
    // reorders the concatenation and breaks the root.
    const proof = inclusionProof(['a', 'b'], 0)
    const [step] = proof.path
    expect(step).toBeDefined()
    if (!step) return
    const flipped = { ...proof, path: [{ ...step, side: step.side === 'left' ? 'right' : 'left' } as const] }
    expect(verifyInclusion(flipped)).toBe(false)
  })

  it('a lone leaf has an empty proof that still verifies', () => {
    const proof = inclusionProof(['only'], 0)
    expect(proof.path).toEqual([])
    expect(verifyInclusion(proof)).toBe(true)
  })

  it('refuses to prove an index outside the batch', () => {
    expect(() => inclusionProof(HASHES(4), 4)).toThrow(LedgerError)
    expect(() => inclusionProof(HASHES(4), -1)).toThrow(LedgerError)
    try {
      inclusionProof(HASHES(4), 9)
    } catch (err) {
      expect((err as LedgerError).code).toBe('MERKLE_INDEX_OUT_OF_RANGE')
    }
  })

  it('refuses a non-integer index', () => {
    expect(() => inclusionProof(HASHES(4), 1.5)).toThrow(LedgerError)
  })

  it('refuses to build a proof over an empty batch', () => {
    expect(() => inclusionProof([], 0)).toThrow(LedgerError)
  })

  it("a valid proof from one batch does not verify against another batch's root", () => {
    const proof = inclusionProof(HASHES(8), 2)
    const otherRoot = merkleRoot(HASHES(9))
    expect(verifyInclusion({ ...proof, root: otherRoot })).toBe(false)
  })
})

// The entry-facing layer: real posted entries, checkpointed and receipted.
const GOLD: Asset = {
  id: 'asset_fg',
  slug: 'flashy-gold',
  symbol: 'FG',
  decimals: 2,
  class: 'REWARD_CURRENCY',
  tenantId: 'flashy',
}

function withId(proposed: ProposedEntry, id: string): Entry {
  return { ...proposed, id }
}

function batch(): Entry[] {
  const at = new Date('2026-08-26T00:00:00.000Z')
  const entries: Entry[] = []
  let state: LedgerState = { balance: ZERO, headHash: null }
  for (let i = 0; i < 6; i++) {
    const proposed = post(state, {
      tenantId: 'flashy',
      identityId: 'identity_1',
      asset: GOLD,
      amount: fromDecimal(10 + i, GOLD.decimals),
      kind: 'EARN',
      source: { type: 'quest', id: `q_${i}` },
      idempotencyKey: `quest:q_${i}:identity_1`,
      occurredAt: at,
    })
    entries.push(withId(proposed, `e_${i}`))
    state = { balance: proposed.balanceAfter, headHash: proposed.hash }
  }
  return entries
}

describe('checkpointRoot / auditReceipt over real entries', () => {
  it('roots a batch of entries by their content hashes', () => {
    const entries = batch()
    expect(checkpointRoot(entries)).toBe(merkleRoot(entries.map((e) => e.hash)))
  })

  it('gives each entry a receipt that verifies against the checkpoint', () => {
    const entries = batch()
    const root = checkpointRoot(entries)
    for (let i = 0; i < entries.length; i++) {
      const receipt = auditReceipt(entries, i)
      expect(receipt.root).toBe(root)
      expect(receipt.leaf).toBe(entries[i]?.hash)
      expect(verifyInclusion(receipt)).toBe(true)
    }
  })

  it("a tampered entry's old receipt no longer matches the new checkpoint", () => {
    const entries = batch()
    const receipt = auditReceipt(entries, 2)

    // Rewrite one entry's amount. Its content hash would change, so the batch
    // it now belongs to has a different root — the old receipt is stale.
    const tampered = entries.map((e, i) => (i === 2 ? { ...e, hash: leafHash('rewritten') } : e))
    const newRoot = checkpointRoot(tampered)
    expect(newRoot).not.toBe(receipt.root)
  })
})

describe('encodeReceipt / decodeReceipt', () => {
  it('round-trips a receipt through JSON and still verifies', () => {
    const proof = inclusionProof(HASHES(11), 7)
    const decoded = decodeReceipt(encodeReceipt(proof))
    expect(decoded).toEqual(proof)
    expect(verifyInclusion(decoded)).toBe(true)
  })

  it('round-trips a lone-leaf receipt with an empty path', () => {
    const proof = inclusionProof(['only'], 0)
    expect(verifyInclusion(decodeReceipt(encodeReceipt(proof)))).toBe(true)
  })

  it('carries a version tag', () => {
    const wire = JSON.parse(encodeReceipt(inclusionProof(HASHES(4), 1))) as { v: number }
    expect(wire.v).toBe(1)
  })

  it('rejects non-JSON', () => {
    expect(() => decodeReceipt('not json')).toThrow(LedgerError)
    try {
      decodeReceipt('not json')
    } catch (err) {
      expect((err as LedgerError).code).toBe('MALFORMED_RECEIPT')
    }
  })

  it('rejects a wrong or missing version', () => {
    const good = JSON.parse(encodeReceipt(inclusionProof(HASHES(4), 1))) as Record<string, unknown>
    expect(() => decodeReceipt(JSON.stringify({ ...good, v: 2 }))).toThrow(/version is 2/)
    expect(() => decodeReceipt(JSON.stringify({ ...good, v: undefined }))).toThrow(LedgerError)
  })

  it('rejects a JSON array or primitive', () => {
    expect(() => decodeReceipt('[]')).toThrow(/not a JSON object/)
    expect(() => decodeReceipt('42')).toThrow(LedgerError)
  })

  it('rejects each malformed field', () => {
    const good = JSON.parse(encodeReceipt(inclusionProof(HASHES(4), 1))) as Record<string, unknown>
    expect(() => decodeReceipt(JSON.stringify({ ...good, leaf: 1 }))).toThrow(/leaf/)
    expect(() => decodeReceipt(JSON.stringify({ ...good, root: null }))).toThrow(/root/)
    expect(() => decodeReceipt(JSON.stringify({ ...good, index: -1 }))).toThrow(/index/)
    expect(() => decodeReceipt(JSON.stringify({ ...good, index: 1.5 }))).toThrow(/index/)
    expect(() => decodeReceipt(JSON.stringify({ ...good, size: 0 }))).toThrow(/size/)
    expect(() => decodeReceipt(JSON.stringify({ ...good, path: 'nope' }))).toThrow(/path/)
  })

  it('rejects a malformed proof step', () => {
    const good = JSON.parse(encodeReceipt(inclusionProof(HASHES(4), 1))) as Record<string, unknown>
    expect(() => decodeReceipt(JSON.stringify({ ...good, path: [{ sibling: 'x' }] }))).toThrow(/side/)
    expect(() => decodeReceipt(JSON.stringify({ ...good, path: [{ sibling: 1, side: 'left' }] }))).toThrow(/sibling/)
    expect(() => decodeReceipt(JSON.stringify({ ...good, path: [{ sibling: 'x', side: 'up' }] }))).toThrow(/side/)
    expect(() => decodeReceipt(JSON.stringify({ ...good, path: ['nope'] }))).toThrow(/not an object/)
  })

  it("a decoded receipt whose root was swapped in transit fails verification", () => {
    // Tamper survives decode (it is well-formed) but fails the math, which is
    // exactly the division of labour: decode checks shape, verify checks truth.
    const good = JSON.parse(encodeReceipt(inclusionProof(HASHES(8), 3))) as Record<string, unknown>
    const decoded = decodeReceipt(JSON.stringify({ ...good, root: leafHash('forged') }))
    expect(verifyInclusion(decoded)).toBe(false)
  })
})
