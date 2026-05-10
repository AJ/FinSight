import { describe, it, expect } from 'vitest';
import { formatCurrency, getCurrencyByCode, parseCurrencyAmount, formatSignedAmount, formatTransactionAmount } from '@/lib/currencyFormatter';

const INR = { code: 'INR', symbol: '₹', name: 'Indian Rupee' };
const USD = { code: 'USD', symbol: '$', name: 'US Dollar' };
const JPY = { code: 'JPY', symbol: '¥', name: 'Japanese Yen' };
const KRW = { code: 'KRW', symbol: '₩', name: 'South Korean Won' };

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

  it('formats zero amount', () => {
    expect(formatCurrency(0, INR)).toBe('₹0');
  });

  it('formats no-decimal currency (JPY) without decimals', () => {
    const result = formatCurrency(1500, JPY);
    // Symbol varies by platform (fullwidth/halfwidth), verify numeric output with no decimals
    expect(result).toContain('1,500');
    expect(result).not.toContain('1,500.');
  });

  it('formats no-decimal currency (KRW) without decimals', () => {
    const result = formatCurrency(25000, KRW);
    expect(result).toContain('25,000');
    expect(result).not.toContain('25,000.');
  });

  it('truncates decimals for no-decimal currencies', () => {
    const result = formatCurrency(1500.99, JPY);
    // 1500.99 should round to 1,501 with no decimal part
    expect(result).toContain('1,501');
    expect(result).not.toContain('1,501.');
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

  it('returns 0 for empty string', () => {
    expect(parseCurrencyAmount('')).toBe(0);
  });

  it('parses negative numbers', () => {
    expect(parseCurrencyAmount('-500.00')).toBe(-500);
  });

  it('handles multiple decimal points by taking first', () => {
    expect(parseCurrencyAmount('1.2.3')).toBe(1.2);
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

  it('shows zero with no sign for credit', () => {
    const result = formatSignedAmount(0, false, INR);
    expect(result).toBe('₹0');
  });

  it('shows zero with no sign for debit', () => {
    const result = formatSignedAmount(0, true, INR);
    expect(result).toBe('₹0');
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
