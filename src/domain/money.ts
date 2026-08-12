/**
 * Money is an integer count of an asset's smallest unit. Never a float.
 *
 * Binary floating point cannot represent most decimal fractions exactly, so a
 * balance held as a float drifts as entries accumulate — and no distributed
 * ledger will accept a fractional value anyway. Every amount in this package is
 * a `Minor`: a whole number of minor units, interpreted against the asset's
 * `decimals`. Gold at 2 decimals stores 12.34 as 1234; wheat at 0 decimals
 * stores 5 as 5.
 */

/** A whole number of an asset's smallest unit. Branded so a raw number cannot pass. */
export type Minor = number & { readonly __brand: 'Minor' };

export class PrecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrecisionError';
  }
}

/** JavaScript integers are exact only to 2^53-1; beyond that, arithmetic lies. */
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export function minor(value: number): Minor {
  if (!Number.isInteger(value)) {
    throw new PrecisionError(`Minor units must be whole numbers, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new PrecisionError(`${value} exceeds exact integer range`);
  }
  return value as Minor;
}

export const ZERO = minor(0);

/**
 * Parse a human-facing decimal amount into minor units.
 *
 * Rejects anything carrying more precision than the asset allows rather than
 * rounding it: silently rounding a member's balance invents or destroys value,
 * and doing so inside a ledger is indefensible.
 */
export function fromDecimal(value: number, decimals: number): Minor {
  if (!Number.isFinite(value)) {
    throw new PrecisionError(`Amount must be finite, got ${value}`);
  }
  const scaled = value * 10 ** decimals;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-9) {
    throw new PrecisionError(
      `${value} carries more precision than ${decimals} decimals permit`,
    );
  }
  return minor(rounded);
}

/** Render minor units for display. Presentation only — never feed this back in. */
export function toDecimal(value: Minor, decimals: number): number {
  return value / 10 ** decimals;
}

export function add(a: Minor, b: Minor): Minor {
  const sum = a + b;
  if (Math.abs(sum) > MAX_SAFE) {
    throw new PrecisionError('Sum exceeds exact integer range');
  }
  return sum as Minor;
}

export function negate(a: Minor): Minor {
  return (a * -1) as Minor;
}

export function isNegative(a: Minor): boolean {
  return a < 0;
}

export function isZero(a: Minor): boolean {
  return a === 0;
}
