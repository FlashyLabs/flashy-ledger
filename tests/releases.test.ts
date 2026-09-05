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

  it('records 0.7.0, which did exist', () => {
    // This test previously asserted the OPPOSITE — that the ledger must not
    // contain a 0.7.0 row, on the belief that the trail went 0.6.3 → 0.8.0.
    // That was wrong, and pinning it made the correct record fail CI, which is
    // the worst shape a guard can take.
    //
    // `6af5ee1` is titled "0.7.0 — declare the civilization commodities" and is
    // the DIRECT PARENT of the 0.8.0 bump `e52704b`. Checked by reading
    // package.json at every commit in the repository: exactly two carry 0.7.0,
    // and no path from 0.6.3 reaches 0.8.0 without passing through it.
    expect(ledgerVersions(releases)).toContain('0.7.0');
  });

  it('does not claim a tag for a publish that failed', () => {
    // 0.6.3 and 0.8.0 died on E401. The workflow tags only after a successful
    // publish, so a tag for either would assert a release that never happened —
    // and would make the dispatch flow refuse the real publish once registry
    // access is fixed.
    for (const v of ['0.6.3', '0.8.0']) {
      const row = releases.split('\n').find((l) => l.startsWith(`| ${v} `));
      expect(row, `${v} has no ledger row`).toBeDefined();
      expect(row).toMatch(/\|\s*❌\s*\|/);
    }
  });
});
