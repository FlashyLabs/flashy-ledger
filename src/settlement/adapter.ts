import type { MinorUnits } from '../lib/money';

/**
 * The settlement seam.
 *
 * A settlement venue is a place a transfer can be *mirrored* — never the
 * place it is *decided*. That distinction is the entire design, and it is
 * what makes "plug a chain in or out" achievable rather than aspirational:
 *
 *   The ledger is the book. A chain is a wire network. Banks did not move
 *   their books onto SWIFT, and for the same reasons. If balances lived
 *   on-chain, a chain's outage would be a product outage, its fees would be
 *   our unit economics, its governance would be our governance — and
 *   unplugging it would mean losing the balances, which means we never
 *   could.
 *
 * So the contract below is deliberately narrow. An adapter is told what
 * already happened and asked to mirror it. There is no method for reading a
 * balance from a venue, and there must never be one: the moment the ledger
 * asks a chain what someone holds, the chain is the book and everything
 * above is decoration.
 *
 * The test of whether this seam is real is REMOVAL. Deleting an adapter from
 * the registry must break nothing, leave every balance intact, and leave
 * history honest about where value was once mirrored. That test lives in
 * settlement.test.ts and is the reason this file has no other
 * responsibilities.
 */

export interface SettlementRequest {
  transferId: string;
  assetSlug: string;
  /** Signed minor units per party, exactly as recorded on the ledger. */
  legs: { partyExternalId: string; amount: MinorUnits }[];
  reason: string;
  /** The ledger's idempotency key, so a venue can dedupe its own retries. */
  idempotencyKey: string;
}

export interface SettlementOutcome {
  /** False means "mirroring failed" — never "the transfer failed". */
  ok: boolean;
  /** The venue's identifier: a transaction hash, a batch id. */
  externalRef?: string;
  error?: string;
}

export interface SettlementAdapter {
  /** Registry key and the value stored on Settlement.venue. */
  readonly name: string;

  /**
   * Whether this venue handles a given asset. A chain adapter that only
   * knows about a wrapped Flashy Gold should say so here rather than failing
   * at settle time, so unsupported combinations never create PENDING rows
   * that can't resolve.
   */
  supports(assetSlug: string): boolean;

  /**
   * Mirror a transfer that has ALREADY been committed to the ledger.
   *
   * Must never throw for an ordinary failure — a venue being down is an
   * expected condition, and the ledger's correctness cannot depend on it.
   * Return `{ ok: false }` and the settlement is recorded FAILED for retry.
   */
  settle(request: SettlementRequest): Promise<SettlementOutcome>;
}
