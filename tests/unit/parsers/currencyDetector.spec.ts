import { describe, it, expect } from 'vitest';
import { detectCurrencyFromText, detectCurrencyFromHeaders, getCurrencyByCode, getLocaleForCurrency } from '@/lib/parsers/currencyDetector';

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

  it('returns null for empty string', () => {
    expect(detectCurrencyFromText('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(detectCurrencyFromText('   ')).toBeNull();
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

  it('normalizes lowercase code to uppercase', () => {
    const result = getCurrencyByCode('inr');
    expect(result).toEqual({ code: 'INR', symbol: '₹', name: 'Indian Rupee' });
  });

  it('normalizes mixed-case code to uppercase', () => {
    const result = getCurrencyByCode('Usd');
    expect(result?.code).toBe('USD');
    expect(result?.symbol).toBe('$');
  });

  it('returns uppercase code regardless of input casing', () => {
    expect(getCurrencyByCode('gbp')?.code).toBe('GBP');
    expect(getCurrencyByCode('Eur')?.code).toBe('EUR');
    expect(getCurrencyByCode('jpy')?.code).toBe('JPY');
  });
});

describe('getLocaleForCurrency — casing normalization', () => {
  it('returns correct locale for uppercase code', () => {
    expect(getLocaleForCurrency('INR')).toBe('en-IN');
  });

  it('normalizes lowercase code the same as uppercase', () => {
    expect(getLocaleForCurrency('inr')).toBe(getLocaleForCurrency('INR'));
  });

  it('normalizes mixed-case code the same as uppercase', () => {
    expect(getLocaleForCurrency('Usd')).toBe(getLocaleForCurrency('USD'));
  });

  it('falls back to en-US for unknown code', () => {
    expect(getLocaleForCurrency('XYZ')).toBe('en-US');
  });

  it('falls back to en-US for unknown lowercase code', () => {
    expect(getLocaleForCurrency('xyz')).toBe('en-US');
  });
});

describe('cross-stage casing consistency', () => {
  it('getCurrencyByCode and getLocaleForCurrency agree on casing', () => {
    const codes = ['inr', 'usd', 'gbp', 'eur', 'jpy', 'INR', 'USD', 'GBP'];
    for (const code of codes) {
      const currency = getCurrencyByCode(code);
      if (currency) {
        // getLocaleForCurrency with lowercase input must produce the same result
        // as with the uppercase code from getCurrencyByCode
        const localeFromInput = getLocaleForCurrency(code);
        const localeFromUppercase = getLocaleForCurrency(currency.code);
        expect(localeFromInput).toBe(localeFromUppercase);
      }
    }
  });

  it('known currencies do not fall back to en-US default for wrong casing', () => {
    // getLocaleForCurrency('inr') should return 'en-IN', not the 'en-US' fallback
    expect(getLocaleForCurrency('inr')).toBe('en-IN');
    expect(getLocaleForCurrency('gbp')).toBe('en-GB');
    expect(getLocaleForCurrency('eur')).toBe('de-DE');
    expect(getLocaleForCurrency('jpy')).toBe('ja-JP');
  });
});
