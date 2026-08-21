/** Every rejection this package can produce, as a type the caller can switch on. */

export class LedgerError extends Error {
  constructor(
    readonly code: LedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}

export type LedgerErrorCode =
  | 'INSUFFICIENT_BALANCE'
  | 'ZERO_AMOUNT'
  | 'MISSING_IDEMPOTENCY_KEY'
  | 'ASSET_NOT_TRANSFERABLE';

export const insufficientBalance = (available: number, requested: number): LedgerError =>
  new LedgerError(
    'INSUFFICIENT_BALANCE',
    `Balance ${available} cannot cover a debit of ${requested}`,
  );

export const zeroAmount = (): LedgerError =>
  new LedgerError('ZERO_AMOUNT', 'An entry of zero records no movement');

export const missingIdempotencyKey = (): LedgerError =>
  new LedgerError(
    'MISSING_IDEMPOTENCY_KEY',
    'Every command needs an idempotency key so retries are safe',
  );

export const assetNotTransferable = (slug: string, assetClass: string): LedgerError =>
  new LedgerError(
    'ASSET_NOT_TRANSFERABLE',
    `${slug} is ${assetClass} and cannot move between identities`,
  );
