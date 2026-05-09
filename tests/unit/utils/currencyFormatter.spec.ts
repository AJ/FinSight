import { describe, it, expect } from 'vitest';
import { formatCurrency, getCurrencyByCode, parseCurrencyAmount, formatSignedAmount, formatTransactionAmount } from '@/lib/currencyFormatter';

const INR = { code: 'INR', symbol: '₹', name: 'Indian Rupee' };
const USD = { code: 'USD', symbol: '$', name: 'US Dollar' };

describe('formatCurrency', () => {
  it('formats whole amount with INR (no decimals for whole numbers)', () => {
    expect(formatCurrency(1299, INR)).toBe('₹1,299');
  });

  it('formats decimal amount with INR', () => {
    expect(formatCurrency(1299.50, INR)).toBe('₹1,299.50');
  });

  it('formats whole amount with USD', () => {
    expect(formatCurrency(1299, USD)).toBe('$1,299');
  });

  it('shows negative sign for negative amounts with showSign=true', () => {
    // formatCurrency uses Math.abs for formatting, then applies sign when showSign=true
    expect(formatCurrency(-500, INR, true)).toBe('-₹500');
  });

  it('hides negative sign for negative amounts with showSign=false', () => {
    expect(formatCurrency(-500, INR, false)).toBe('₹500');
  });
});

describe('getCurrencyByCode', () => {
  it('finds INR', () => {
    const result = getCurrencyByCode('INR');
    expect(result?.code).toBe('INR');
    expect(result?.symbol).toBe('₹');
  });

  it('returns undefined for unknown code', () => {
    expect(getCurrencyByCode('XYZ')).toBeUndefined();
  });
});

describe('parseCurrencyAmount', () => {
  it('parses a plain number string', () => {
    expect(parseCurrencyAmount('123.45')).toBe(123.45);
  });

  it('strips currency symbols and commas', () => {
    expect(parseCurrencyAmount('₹1,299.50')).toBe(1299.5);
  });

  it('returns 0 for non-numeric input', () => {
    expect(parseCurrencyAmount('abc')).toBe(0);
  });
});

describe('formatSignedAmount', () => {
  it('shows negative sign for debits', () => {
    const result = formatSignedAmount(500, true, INR);
    expect(result).toBe('-₹500');
  });

  it('shows no sign for credits', () => {
    const result = formatSignedAmount(500, false, INR);
    expect(result).toBe('₹500');
  });
});

describe('formatTransactionAmount', () => {
  it('formats debit transaction with negative sign', () => {
    const result = formatTransactionAmount({
      amount: 100,
      type: { isDebit: true },
      localCurrency: INR,
    });
    expect(result).toBe('-₹100');
  });

  it('formats credit transaction with no sign', () => {
    const result = formatTransactionAmount({
      amount: 100,
      type: { isDebit: false },
      localCurrency: INR,
    });
    expect(result).toBe('₹100');
  });
});
