import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * devlog/1 — the human-readable half of shipped/1.
 *
 * See the `devlog/1` section of `packages/shiplog/SPEC.md` in flashyos.
 * `vendor-shiplog.mjs` writes `DEVLOG.md` and `devlog.fragment.json` on every
 * `emit`, derived from the same commit history the ship log already reads;
 * nothing here shapes them a second time.
 *
 * `.shiplog/config.json` already serves `shiplog.json` from
 * `public/.well-known/` — no confirmed live deployment was found for this
 * repository (it publishes an npm package; no Vercel/Pages/deploy workflow
 * exists here), so that served copy's reachability is unverified and
 * pre-existing. `serveDevlog` matches the SAME established local pattern
 * rather than inventing a new one.
 */
const root = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');
const json = (...p: string[]): unknown => JSON.parse(read(...p));
const DEVLOG_ID_RE = /^devlog\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

interface DevlogEntry {
  id: string;
  at: string;
  summary: string;
  commitSha: string;
  ref: string;
}

interface DevlogFragment {
  devlog: string;
  source: string;
  org: string;
  entries: DevlogEntry[];
}

interface ShiplogConfig {
  source: string;
  org: string;
  serveDevlog?: string;
}

describe('devlog/1', () => {
  it('the vendored emitter is byte-identical to its source (unknown, never current, when flashyos is not beside)', () => {
    const canon = join(root, '..', 'flashyos', 'packages', 'shiplog', 'vendor-shiplog.mjs');
    if (!existsSync(canon)) {
      console.warn('vendor-shiplog.mjs: unknown — flashyos is not checked out beside this repository');
      return;
    }
    expect(read('vendor-shiplog.mjs')).toBe(readFileSync(canon, 'utf8'));
  });

  it('devlog.fragment.json is a well-formed devlog/1 fragment derived from this repository', () => {
    expect(existsSync(join(root, 'devlog.fragment.json'))).toBe(true);
    const fragment = json('devlog.fragment.json') as DevlogFragment;
    const config = json('.shiplog', 'config.json') as ShiplogConfig;
    expect(fragment.devlog).toBe('1');
    expect(fragment.source).toBe(config.source);
    expect(fragment.org).toBe(config.org);
    expect(Array.isArray(fragment.entries)).toBe(true);
    for (const entry of fragment.entries) {
      expect(entry.id).toMatch(DEVLOG_ID_RE);
      expect(entry.summary.length).toBeGreaterThan(0);
      expect(entry.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(entry.ref).toMatch(/^https:\/\//);
      expect(Object.keys(entry).sort()).toEqual(['at', 'commitSha', 'id', 'ref', 'summary']);
    }
  });

  it('the served copy under public/.well-known carries the same entries as the emitted fragment, per the config that owns it', () => {
    const config = json('.shiplog', 'config.json') as ShiplogConfig;
    expect(config.serveDevlog).toBe('public/.well-known/devlog.fragment.json');
    const root = json('devlog.fragment.json') as DevlogFragment;
    const served = json('public', '.well-known', 'devlog.fragment.json') as DevlogFragment;
    // Not byte-identical: the emitter stamps each write with its own
    // `new Date().toISOString()`, a few milliseconds apart.
    expect(served.devlog).toBe(root.devlog);
    expect(served.source).toBe(root.source);
    expect(served.org).toBe(root.org);
    expect(served.entries).toEqual(root.entries);
  });

  it('DEVLOG.md is the same document rendered for a person, not a second source of truth', () => {
    const md = read('DEVLOG.md');
    const fragment = json('devlog.fragment.json') as DevlogFragment;
    expect(md).toMatch(/^# Devlog/);
    for (const entry of fragment.entries) {
      expect(md.includes(entry.commitSha.slice(0, 12))).toBe(true);
    }
  });
});
