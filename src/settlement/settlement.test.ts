import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAdapter, unregisterAdapter, listVenues, settleTransfer, resetRegistry } from './registry';
import { NATIVE_VENUE } from './nativeAdapter';
import type { SettlementAdapter, SettlementOutcome } from './adapter';
import { prisma } from '../lib/prisma';

vi.mock('../lib/prisma', () => ({
  prisma: { settlement: { upsert: vi.fn(), updateMany: vi.fn() } },
}));

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

/** A stand-in for a chain adapter. Behaviour is injected so each test states its own scenario. */
function fakeChain(
  name: string,
  behaviour: () => Promise<SettlementOutcome>,
  // Explicitly boolean: left to inference, the default narrows to a type
  // predicate and no other predicate can be passed.
  supported: (slug: string) => boolean = (slug) => slug === 'flashy-gold',
): SettlementAdapter {
  return { name, supports: supported, settle: behaviour };
}

const REQUEST = {
  transferId: 'tr-1',
  assetSlug: 'flashy-gold',
  legs: [
    { partyExternalId: 'alice', amount: -500n },
    { partyExternalId: 'bob', amount: 500n },
  ],
  reason: 'test',
  idempotencyKey: 'k-1',
};

describe('settlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRegistry();
    mock(prisma.settlement.upsert).mockResolvedValue({});
    mock(prisma.settlement.updateMany).mockResolvedValue({ count: 0 });
  });

  describe('the registry', () => {
    it('always has the native venue', () => {
      expect(listVenues()).toEqual([NATIVE_VENUE]);
    });

    it('registers an additional venue', () => {
      registerAdapter(fakeChain('ton', async () => ({ ok: true, externalRef: '0xabc' })));
      expect(listVenues()).toContain('ton');
    });

    // Removing native would mean transfers settle nowhere at all — that is
    // not "unplugged", it's broken.
    it('refuses to remove the native venue', () => {
      expect(unregisterAdapter(NATIVE_VENUE)).toBe(false);
      expect(listVenues()).toContain(NATIVE_VENUE);
    });
  });

  describe('settling', () => {
    it('records a confirmed settlement per venue', async () => {
      registerAdapter(fakeChain('ton', async () => ({ ok: true, externalRef: '0xabc' })));

      const results = await settleTransfer(REQUEST);

      expect(results).toEqual(
        expect.arrayContaining([
          { venue: NATIVE_VENUE, status: 'CONFIRMED', externalRef: 'tr-1' },
          { venue: 'ton', status: 'CONFIRMED', externalRef: '0xabc' },
        ]),
      );
      expect(prisma.settlement.upsert).toHaveBeenCalledTimes(2);
    });

    it('skips a venue that does not support the asset', async () => {
      registerAdapter(fakeChain('ton', async () => ({ ok: true }), (slug) => slug === 'something-else'));

      const results = await settleTransfer(REQUEST);

      expect(results.map((r) => r.venue)).toEqual([NATIVE_VENUE]);
    });

    // The transfer already happened. Reporting failure because a mirror is
    // down would be a false negative about something that is already true.
    it('records a venue failure without affecting the others', async () => {
      registerAdapter(fakeChain('ton', async () => ({ ok: false, error: 'rpc timeout' })));

      const results = await settleTransfer(REQUEST);

      expect(results).toEqual(
        expect.arrayContaining([
          { venue: NATIVE_VENUE, status: 'CONFIRMED', externalRef: 'tr-1' },
          { venue: 'ton', status: 'FAILED', error: 'rpc timeout' },
        ]),
      );
    });

    // An adapter throwing where the contract says return ok:false is a bug
    // in the adapter, and must not become an outage in the ledger.
    it('contains an adapter that throws instead of returning', async () => {
      registerAdapter(
        fakeChain('rogue', async () => {
          throw new Error('adapter exploded');
        }),
      );

      const results = await settleTransfer(REQUEST);

      expect(results).toEqual(
        expect.arrayContaining([
          { venue: NATIVE_VENUE, status: 'CONFIRMED', externalRef: 'tr-1' },
          { venue: 'rogue', status: 'FAILED', error: 'adapter exploded' },
        ]),
      );
    });

    it('never rejects, whatever the venues do', async () => {
      registerAdapter(
        fakeChain('rogue', async () => {
          throw new Error('boom');
        }),
      );
      await expect(settleTransfer(REQUEST)).resolves.toBeDefined();
    });
  });

  /**
   * The test the whole seam exists for.
   *
   * "Pluggable" is only true if unplugging is safe, and the only way to know
   * that is to unplug. If any of these fail, the chain has become load-bearing
   * and the architecture has quietly inverted.
   */
  describe('removal — the proof that pluggability is real', () => {
    it('settles normally again after a venue is removed', async () => {
      registerAdapter(fakeChain('ton', async () => ({ ok: true, externalRef: '0xabc' })));
      expect(listVenues()).toContain('ton');

      expect(unregisterAdapter('ton')).toBe(true);
      const results = await settleTransfer(REQUEST);

      expect(results).toEqual([{ venue: NATIVE_VENUE, status: 'CONFIRMED', externalRef: 'tr-1' }]);
      expect(listVenues()).toEqual([NATIVE_VENUE]);
    });

    it('is unaffected by removing a venue that was failing', async () => {
      registerAdapter(fakeChain('ton', async () => ({ ok: false, error: 'chain halted' })));
      await settleTransfer(REQUEST);

      unregisterAdapter('ton');
      const afterRemoval = await settleTransfer(REQUEST);

      expect(afterRemoval.every((r) => r.status === 'CONFIRMED')).toBe(true);
    });

    it('reports removing an unknown venue rather than pretending it worked', () => {
      expect(unregisterAdapter('never-registered')).toBe(false);
    });
  });
});
