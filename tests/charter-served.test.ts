import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The charter must be served where the checker reads it.
 *
 * `@flashyos/conformance` reads a charter from
 * `/.well-known/flashyos-charter.json` and **nowhere else**. Having one in the
 * repository is a different fact from serving one, and the estate has now got
 * that wrong three times: nine properties were fixed in August 2026 and written
 * up as closed, a read of every default branch on 30 August found seven still
 * holding a complete roster and serving it nowhere, and this property was one
 * of them on 31 August.
 *
 * A conformance run against this domain stops at L1 while the roster sits in
 * git looking finished. Nothing fails; the level is simply never reached.
 *
 * Byte-identity rather than a field-by-field comparison, deliberately: a test
 * that checks the fields somebody thought to list is a test that says nothing
 * about the field they add next week.
 */
const root = join(__dirname, '..');
const repo = readFileSync(join(root, 'flashyos.roles.json'), 'utf8');
const served = readFileSync(join(root, 'public', '.well-known', 'flashyos-charter.json'), 'utf8');

describe('/.well-known/flashyos-charter.json', () => {
  it('is byte-identical to the charter this repository holds', () => {
    expect(served).toBe(repo);
  });

  it('is a charter, not an empty file that happens to exist', () => {
    const parsed = JSON.parse(served);
    expect(parsed.slug, 'a charter with no slug names no organisation').toBeTruthy();
    expect(Array.isArray(parsed.roles) && parsed.roles.length > 0,
      'a roster of zero roles reads to the network as an org that declares nothing').toBe(true);
  });
});
