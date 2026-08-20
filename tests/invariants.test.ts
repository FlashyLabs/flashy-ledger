import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The spec and the suite must agree.
 *
 * docs/INVARIANTS.md is the artifact an auditor reads, which makes it exactly
 * the kind of document that drifts: a test gets renamed, the doc keeps citing
 * the old name, and the citation quietly stops meaning anything. Nothing else in
 * this suite would notice.
 *
 * So the mapping is checked. Every invariant names a test, and every test it
 * names exists.
 */

const SPEC = readFileSync('docs/INVARIANTS.md', 'utf8')

const TEST_SOURCE = readdirSync('tests')
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => readFileSync(join('tests', f), 'utf8'))
  .join('\n')

/** Invariant headings, e.g. "## I-1 · Append-only". */
const invariants = [...SPEC.matchAll(/^## (I-\d+) · (.+)$/gm)].map((m) => ({
  id: m[1],
  name: m[2],
}))

/** Cited test names, written as › *the test name*. */
const citations = [...SPEC.matchAll(/›\s*\*([^*]+)\*/g)]
  .map((m) => m[1]?.trim())
  .filter((name): name is string => Boolean(name))

describe('the invariant spec', () => {
  it('numbers every invariant contiguously from I-1', () => {
    expect(invariants.length).toBeGreaterThan(0)
    invariants.forEach((inv, i) => {
      expect(inv.id, 'invariants must be numbered without gaps').toBe(`I-${i + 1}`)
    })
  })

  it('gives every invariant a claim, a reason, an enforcement and a proof', () => {
    for (const inv of invariants) {
      const section = SPEC.split(`## ${inv.id} ·`)[1]?.split('\n## ')[0] ?? ''
      for (const heading of ['**Claim.**', '**Why.**', '**Enforced by.**', '**Proved by.**']) {
        expect(section, `${inv.id} (${inv.name}) is missing ${heading}`).toContain(heading)
      }
    }
  })

  it('cites only tests that exist', () => {
    expect(citations.length).toBeGreaterThanOrEqual(invariants.length)
    for (const name of citations) {
      expect(
        TEST_SOURCE.includes(name),
        `docs/INVARIANTS.md cites a test that does not exist: "${name}"`,
      ).toBe(true)
    }
  })

  it('covers tenant isolation, which 0.2.0 added', () => {
    // A specific guard: the newest invariant is the one most likely to be
    // dropped from the doc in a later edit, because it is the least familiar.
    expect(SPEC).toContain('Tenant isolation')
    expect(SPEC).toContain('(tenantId, idempotencyKey)')
  })
})
