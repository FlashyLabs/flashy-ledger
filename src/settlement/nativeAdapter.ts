import type { SettlementAdapter, SettlementRequest, SettlementOutcome } from './adapter';

export const NATIVE_VENUE = 'native';

/**
 * The default venue, and the reason the default costs nothing.
 *
 * Flashy Gold settles natively: the ledger entry IS the settlement, so this
 * adapter confirms immediately and does no work. That is not a stub — it is
 * the honest expression of what native settlement means, and it exists so
 * the settlement path has exactly one shape whether or not an external venue
 * is configured.
 *
 * Without it, "settled natively" and "settled on a chain" would be two
 * different code paths, and the native path would be the one nobody tests.
 */
export class NativeAdapter implements SettlementAdapter {
  readonly name = NATIVE_VENUE;

  /** Every asset settles natively; that is what makes the ledger authoritative. */
  supports(): boolean {
    return true;
  }

  async settle(request: SettlementRequest): Promise<SettlementOutcome> {
    // The transfer is already committed. Mirroring it to ourselves is a
    // no-op, and the ledger's own transfer id is the only external reference
    // that could honestly be given.
    return { ok: true, externalRef: request.transferId };
  }
}
