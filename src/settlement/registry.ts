import { prisma } from '../lib/prisma';
import type { SettlementAdapter, SettlementRequest } from './adapter';
import { NativeAdapter, NATIVE_VENUE } from './nativeAdapter';

/**
 * Which venues are active, and the code that mirrors a transfer to them.
 *
 * The registry is mutable at runtime rather than a compile-time list,
 * because that is what "unplug a chain" has to mean operationally: an
 * incident at 3am is resolved by removing a venue, not by shipping a
 * release. Removal is safe by construction — see `settleTransfer` for why
 * nothing above the ledger notices.
 */

const adapters = new Map<string, SettlementAdapter>();

/** The native venue is always present. Registering it explicitly keeps the map the only source of truth. */
export function resetRegistry(): void {
  adapters.clear();
  adapters.set(NATIVE_VENUE, new NativeAdapter());
}

resetRegistry();

export function registerAdapter(adapter: SettlementAdapter): void {
  adapters.set(adapter.name, adapter);
}

/**
 * Pull a venue out of service.
 *
 * Deliberately allowed for any venue except native: native settlement is
 * what makes the ledger authoritative, so removing it would mean transfers
 * settle nowhere at all — which is not "unplugged", it's broken.
 */
export function unregisterAdapter(name: string): boolean {
  if (name === NATIVE_VENUE) return false;
  return adapters.delete(name);
}

export function listVenues(): string[] {
  return Array.from(adapters.keys());
}

export interface SettlementSummary {
  venue: string;
  status: 'CONFIRMED' | 'FAILED';
  externalRef?: string;
  error?: string;
}

/**
 * Mirror a committed transfer to every venue that supports its asset.
 *
 * Three properties worth stating, because each is a decision:
 *
 *   It runs AFTER the ledger transaction has committed, never inside it. A
 *   venue's latency or outage must not be able to hold a database
 *   transaction open, and a venue failing must not roll back value that has
 *   already legitimately moved.
 *
 *   A venue failure is recorded, not thrown. The transfer happened. Failing
 *   the caller because a mirror is down would report a false negative about
 *   something that is already true.
 *
 *   Venues are independent. One failing does not prevent the others, and no
 *   venue can observe or affect another's result.
 */
export async function settleTransfer(request: SettlementRequest): Promise<SettlementSummary[]> {
  const applicable = Array.from(adapters.values()).filter((adapter) => adapter.supports(request.assetSlug));

  const results = await Promise.all(
    applicable.map(async (adapter): Promise<SettlementSummary> => {
      try {
        const outcome = await adapter.settle(request);
        return outcome.ok
          ? { venue: adapter.name, status: 'CONFIRMED', externalRef: outcome.externalRef }
          : { venue: adapter.name, status: 'FAILED', error: outcome.error ?? 'settlement failed' };
      } catch (err) {
        // An adapter is third-party-ish code by nature. A throw where the
        // contract says "return ok:false" is a bug in the adapter, and it
        // must not become an outage in the ledger.
        return { venue: adapter.name, status: 'FAILED', error: (err as Error)?.message ?? 'adapter threw' };
      }
    }),
  );

  await Promise.all(
    results.map((result) =>
      prisma.settlement.upsert({
        where: { transferId_venue: { transferId: request.transferId, venue: result.venue } },
        create: {
          transferId: request.transferId,
          venue: result.venue,
          status: result.status,
          externalRef: result.externalRef,
          error: result.error,
        },
        update: { status: result.status, externalRef: result.externalRef, error: result.error },
      }),
    ),
  );

  return results;
}

/**
 * Settlements left stranded when a venue was removed mid-flight.
 *
 * Marked ABANDONED rather than deleted: history should stay honest about
 * where value was once mirrored, even after we stop mirroring there.
 */
export async function abandonStrandedSettlements(): Promise<number> {
  const active = listVenues();
  const result = await prisma.settlement.updateMany({
    where: { status: 'PENDING', venue: { notIn: active } },
    data: { status: 'ABANDONED' },
  });
  return result.count;
}
