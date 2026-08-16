/**
 * Money, as an integer count of minor units.
 *
 * This module exists to make the wrong thing hard to type. The bug it
 * prevents is not exotic — it is someone writing `balance * 1.05` and
 * shipping it, which is exactly how the current implementation ended up with
 * Float columns underneath a schema that declares two decimal places.
 *
 * Rules enforced here:
 *   - Amounts are `bigint`. There is no float path in or out.
 *   - Parsing a human-entered decimal is explicit and rejects excess
 *     precision rather than silently rounding it away. Silent rounding is
 *     how a ledger loses a fraction of a unit per transaction and nobody
 *     notices for a year.
 *   - Formatting is for display only and never feeds back into arithmetic.
 */

export class MoneyError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Minor units. 100 with decimals=2 means 1.00. */
export type MinorUnits = bigint;

// Unsigned deliberately. The sign is stripped before these are applied, so
// allowing one here would make "--1" parse as 1 — a double negative that
// silently flips the direction of a transfer.
const DIGITS = /^\d+$/;

/**
 * Parse a human-facing decimal string ("12.34") into minor units.
 *
 * Takes a string, not a number, on purpose: by the time a value is a JS
 * `number` the precision loss has already happened, and accepting one here
 * would make this function a rubber stamp on the very problem it exists to
 * catch.
 */
export function parseAmount(input: string, decimals: number): MinorUnits {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new MoneyError('INVALID_DECIMALS', 'decimals must be an integer between 0 and 18');
  }

  const trimmed = input.trim();
  if (trimmed === '') {
    throw new MoneyError('INVALID_AMOUNT', 'amount is empty');
  }

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const parts = unsigned.split('.');
  const [whole = '', fraction = ''] = parts;

  // Both halves must be present and unsigned when a separator appears, so
  // ".5" and "5." are rejected rather than guessed at. A typo in a money
  // amount should fail loudly, not resolve to whatever seems likely.
  const malformed =
    parts.length > 2 || !DIGITS.test(whole) || (parts.length === 2 && !DIGITS.test(fraction));
  if (malformed) {
    throw new MoneyError('INVALID_AMOUNT', `"${input}" is not a valid decimal amount`);
  }
  // Rejected rather than rounded. A caller passing more precision than the
  // asset has is either confused about the asset or about to lose money;
  // both are worth an error rather than a silent truncation.
  if (fraction.length > decimals) {
    throw new MoneyError(
      'EXCESS_PRECISION',
      `"${input}" has ${fraction.length} decimal places but this asset has ${decimals}`,
    );
  }

  const padded = fraction.padEnd(decimals, '0');
  const magnitude = BigInt(whole + padded);
  return negative ? -magnitude : magnitude;
}

/** Render minor units for display. Never feed the result back into arithmetic. */
export function formatAmount(amount: MinorUnits, decimals: number): string {
  if (decimals === 0) return amount.toString();

  const negative = amount < 0n;
  const magnitude = (negative ? -amount : amount).toString().padStart(decimals + 1, '0');
  const whole = magnitude.slice(0, magnitude.length - decimals);
  const fraction = magnitude.slice(magnitude.length - decimals);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Assert a value is a usable amount. Zero is rejected: a zero-amount entry
 * carries no information, and any transfer that produces one is a bug that
 * happens to balance.
 */
export function assertNonZero(amount: MinorUnits): void {
  if (amount === 0n) {
    throw new MoneyError('ZERO_AMOUNT', 'amount must not be zero');
  }
}

export function assertPositive(amount: MinorUnits): void {
  if (amount <= 0n) {
    throw new MoneyError('NON_POSITIVE_AMOUNT', 'amount must be greater than zero');
  }
}

/** Sum with no intermediate float. The whole point. */
export function sum(amounts: MinorUnits[]): MinorUnits {
  return amounts.reduce((total, amount) => total + amount, 0n);
}
