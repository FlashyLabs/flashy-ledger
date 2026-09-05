import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The release ledger and this test exist together: a package whose pitch is
// verifiability must not carry a published version that nothing wrote down.
// See RELEASES.md for the measured trail and why 0.6.3/0.8.0 have no tag.

const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
const releases = readFileSync(join(root, 'RELEASES.md'), 'utf8');

/** Every `| x.y.z |` in the first table column — the versions the ledger records. */
function ledgerVersions(md: string): string[] {
  const versions: string[] = [];
  for (const line of md.split('\n')) {
    const m = /^\|\s*(\d+\.\d+\.\d+)\s*\|/.exec(line);
    if (m && m[1]) versions.push(m[1]);
  }
  return versions;
}

describe('release ledger', () => {
  it("records the version package.json currently declares", () => {
    // The check that turns "shipped a version nobody wrote down" from a silent
    // gap into a red build. Bump the version, add a row, or this fails.
    expect(ledgerVersions(releases)).toContain(pkg.version);
  });

  it('lists each version at most once', () => {
    const seen = ledgerVersions(releases);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('is in ascending version order — the trail reads as a history', () => {
    const key = (v: string): number => {
      const [major = 0, minor = 0, patch = 0] = v.split('.').map(Number);
      return major * 1_000_000 + minor * 1_000 + patch;
    };
    const seen = ledgerVersions(releases);
    const sorted = [...seen].sort((a, b) => key(a) - key(b));
    expect(seen).toEqual(sorted);
  });

  it('does not invent a 0.7.0 — the trail went 0.6.3 → 0.8.0', () => {
    // Pinned because the roadmap claimed a 0.7.0 that never existed; a future
    // reader adding one on that belief should have to reckon with this line.
    expect(ledgerVersions(releases)).not.toContain('0.7.0');
  });
});
