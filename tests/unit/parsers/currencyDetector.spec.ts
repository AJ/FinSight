import { describe, it, expect } from 'vitest';
import { detectCurrencyFromText, detectCurrencyFromHeaders, getCurrencyByCode } from '@/lib/parsers/currencyDetector';

describe('detectCurrencyFromText — symbol detection', () => {
  it('detects INR by symbol ₹', () => {
    const result = detectCurrencyFromText('₹1,299.00');
    expect(result?.code).toBe('INR');
  });

  it('detects INR by code INR', () => {
    const result = detectCurrencyFromText('INR 1,299.00');
    expect(result?.code).toBe('INR');
  });

  it('detects USD by symbol $', () => {
    const result = detectCurrencyFromText('$1,299.00');
    expect(result?.code).toBe('USD');
  });

  it('detects USD by code USD', () => {
    const result = detectCurrencyFromText('USD 1,299.00');
    expect(result?.code).toBe('USD');
  });

  it('detects GBP by symbol £', () => {
    const result = detectCurrencyFromText('£500.00');
    expect(result?.code).toBe('GBP');
  });

  it('detects EUR by code EUR', () => {
    const result = detectCurrencyFromText('EUR 100.00');
    expect(result?.code).toBe('EUR');
  });

  it('picks highest weighted match in mixed currency text', () => {
    const result = detectCurrencyFromText('₹100 and $50 and €25');
    // ₹ (symbol weight=3) vs $ (symbol weight=3) vs € (symbol weight=3)
    // All score 3; INR comes first in the DB so it wins
    expect(result?.code).toBe('INR');
  });

  it('returns null for text with no currency indicators', () => {
    expect(detectCurrencyFromText('1299.00')).toBeNull();
  });

  it('handles large text with currency at the end', () => {
    // Currency detector samples first 5000 + last 2000 chars
    const text = 'A'.repeat(6000) + '₹500';
    const result = detectCurrencyFromText(text);
    expect(result?.code).toBe('INR');
  });
});

describe('detectCurrencyFromHeaders', () => {
  it('detects from column header with symbol', () => {
    const result = detectCurrencyFromHeaders(['Amount (₹)', 'Date']);
    expect(result?.code).toBe('INR');
  });

  it('detects from ISO code in header', () => {
    const result = detectCurrencyFromHeaders(['Amount', 'INR']);
    expect(result?.code).toBe('INR');
  });
});

describe('getCurrencyByCode', () => {
  it('looks up valid code INR', () => {
    const result = getCurrencyByCode('INR');
    expect(result).toEqual({ code: 'INR', symbol: '₹', name: 'Indian Rupee' });
  });

  it('returns undefined for unknown code', () => {
    expect(getCurrencyByCode('XYZ')).toBeUndefined();
  });
});
