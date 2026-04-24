import { describe, it, expect } from 'vitest';
import { getAPRForIssuer, DEFAULT_APR_BY_ISSUER, DEFAULT_MIN_PAYMENT_PERCENT, DEFAULT_MIN_PAYMENT_FLOOR, MONTHS_IN_YEAR } from '@/lib/creditCard/constants';

describe('getAPRForIssuer', () => {
  it('finds exact match for HDFC', () => {
    expect(getAPRForIssuer('HDFC Bank')).toBe(0.408);
  });

  it('finds partial match', () => {
    expect(getAPRForIssuer('HDFC')).toBe(0.408);
    expect(getAPRForIssuer('ICICI')).toBe(0.42);
  });

  it('returns default for unknown issuer', () => {
    expect(getAPRForIssuer('Unknown Bank')).toBe(0.408);
  });

  it('prefers extracted APR if provided', () => {
    expect(getAPRForIssuer('HDFC Bank', 0.50)).toBe(0.50);
  });
});

describe('constants', () => {
  it('DEFAULT_MIN_PAYMENT_PERCENT is 5%', () => {
    expect(DEFAULT_MIN_PAYMENT_PERCENT).toBe(0.05);
  });

  it('DEFAULT_MIN_PAYMENT_FLOOR is Rs 200', () => {
    expect(DEFAULT_MIN_PAYMENT_FLOOR).toBe(200);
  });

  it('MONTHS_IN_YEAR is 12', () => {
    expect(MONTHS_IN_YEAR).toBe(12);
  });

  it('has expected number of issuers', () => {
    expect(Object.keys(DEFAULT_APR_BY_ISSUER).length).toBeGreaterThan(10);
  });
});
