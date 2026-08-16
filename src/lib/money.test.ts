import { describe, it, expect } from 'vitest';
import { parseAmount, formatAmount, sum, assertNonZero, assertPositive, MoneyError } from './money';

describe('money', () => {
  describe('parseAmount', () => {
    it('parses a decimal into minor units', () => {
      expect(parseAmount('12.34', 2)).toBe(1234n);
      expect(parseAmount('0.01', 2)).toBe(1n);
      expect(parseAmount('100', 2)).toBe(10000n);
    });

    it('pads a short fraction', () => {
      expect(parseAmount('1.5', 2)).toBe(150n);
    });

    it('handles zero-decimal assets', () => {
      expect(parseAmount('42', 0)).toBe(42n);
    });

    it('parses negatives', () => {
      expect(parseAmount('-12.34', 2)).toBe(-1234n);
    });

    // Rounding here is how a ledger loses a fraction of a unit per
    // transaction and nobody notices for a year.
    it('rejects excess precision rather than rounding it away', () => {
      expect(() => parseAmount('1.234', 2)).toThrow(MoneyError);
      expect(() => parseAmount('1.234', 2)).toThrow(/3 decimal places/);
    });

    // '--1' is the one that matters: a double negative that parsed would
    // silently flip the direction of a transfer.
    it.each(['', '  ', 'abc', '1.2.3', '1..2', '1e5', '--1', '.5', '5.', '+1', '1 000'])(
      'rejects %j',
      (input) => {
        expect(() => parseAmount(input, 2)).toThrow(MoneyError);
      },
    );

    it('rejects nonsense decimals settings', () => {
      expect(() => parseAmount('1.00', -1)).toThrow(MoneyError);
      expect(() => parseAmount('1.00', 1.5)).toThrow(MoneyError);
    });

    // The precision is already gone by the time a value is a JS number, so
    // the signature takes a string and the type system enforces it.
    it('exceeds Number.MAX_SAFE_INTEGER without loss', () => {
      const huge = '90071992547409910.00';
      expect(parseAmount(huge, 2)).toBe(9007199254740991000n);
    });
  });

  describe('formatAmount', () => {
    it('renders minor units for display', () => {
      expect(formatAmount(1234n, 2)).toBe('12.34');
      expect(formatAmount(1n, 2)).toBe('0.01');
      expect(formatAmount(0n, 2)).toBe('0.00');
      expect(formatAmount(-1234n, 2)).toBe('-12.34');
    });

    it('leaves zero-decimal assets alone', () => {
      expect(formatAmount(42n, 0)).toBe('42');
    });

    it('round-trips through parseAmount', () => {
      for (const value of ['0.00', '1.00', '12.34', '-99.99', '1000000.01']) {
        expect(formatAmount(parseAmount(value, 2), 2)).toBe(value);
      }
    });
  });

  describe('guards', () => {
    it('rejects a zero amount — it carries no information', () => {
      expect(() => assertNonZero(0n)).toThrow(MoneyError);
      expect(() => assertNonZero(-1n)).not.toThrow();
    });

    it('rejects non-positive where positivity is required', () => {
      expect(() => assertPositive(0n)).toThrow(MoneyError);
      expect(() => assertPositive(-1n)).toThrow(MoneyError);
      expect(() => assertPositive(1n)).not.toThrow();
    });
  });

  describe('sum', () => {
    it('sums without an intermediate float', () => {
      expect(sum([1n, 2n, -3n])).toBe(0n);
      expect(sum([])).toBe(0n);
    });

    // The canonical float failure, which is why none of this is a number.
    it('is exact where floating point is not', () => {
      const tenth = parseAmount('0.10', 2);
      expect(sum(Array.from({ length: 10 }, () => tenth))).toBe(parseAmount('1.00', 2));
      expect(0.1 + 0.2).not.toBe(0.3);
    });
  });
});
