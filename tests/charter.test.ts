import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * This package's AAO charter.
 *
 * A published npm package, not a website — there is no origin to serve a
 * well-known path from, so this cannot hold a conformance level of its own.
 * The charter still matters: the branch-mesh sync reads it to decide which
 * branches report as which role on the public network, and a charter that
 * fails the validator is a roster that describes nobody.
 *
 * It did fail. The comment block was `_comment`, and the AAO validator rejects
 * any top-level key that is neither a spec field nor `x-` prefixed — so the
 * static conformance suite, which stops at the first invalid manifest, failed
 * ALL FIVE of its questions over one underscore.
 */

const charter = JSON.parse(readFileSync(join(__dirname, '..', 'flashyos.roles.json'), 'utf8'))

const SPEC_KEYS = [
  'aao', 'name', 'slug', 'description', 'accountableTo', 'roles', 'network',
  'repositories', 'escalation',
]
const FAMILIES = [
  'growth', 'revenue', 'product', 'engineering', 'operations',
  'data', 'finance', 'risk', 'governance', 'support',
]

describe('the AAO charter', () => {
  it('speaks aao 0.1 and names the human who answers', () => {
    expect(charter.aao).toBe('0.1')
    expect(charter.accountableTo).toMatch(/^[^@\s]+@[^@\s.]+\.[^@\s]+$/)
  })

  it('carries only spec keys and x- extensions', () => {
    // The bug this test exists for. One unprefixed key failed every static
    // conformance question, because the suite stops at the first invalid
    // manifest — a fully-populated roster read as an org that had declared
    // nothing at all.
    for (const key of Object.keys(charter)) {
      expect(SPEC_KEYS.includes(key) || key.startsWith('x-'), key).toBe(true)
    }
  })

  it('gives every role a family, a stranger-readable purpose and real capabilities', () => {
    expect(charter.roles.length).toBeGreaterThan(0)
    for (const role of charter.roles) {
      expect(role.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(role.name.length, role.name).toBeLessThanOrEqual(24)
      expect(FAMILIES, `${role.name}: ${role.family}`).toContain(role.family)
      expect(role.purpose.length, `${role.name} purpose`).toBeGreaterThan(30)
      expect(role.capabilities.length, `${role.name} capabilities`).toBeGreaterThan(0)
    }
  })

  it('gives every role an approval threshold — this package has real consumers', () => {
    // A change to an exported signature is a breaking change for somebody
    // else's build, and the hashing rules decide whether previously issued
    // proofs still verify. Nothing here is an unattended change.
    for (const role of charter.roles) {
      expect(role.humanApprovalAtOrAbove, role.name).toBeTruthy()
    }
  })
})
