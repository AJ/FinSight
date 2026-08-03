import { describe, it, expect } from 'vitest';

import { categorizeTransaction, normalizeMerchantName } from '@/lib/categorizer';
import '@/lib/categorization/categories';

describe('categorizeTransaction keyword fallback (constrained by subtype — spec §3.2)', () => {
  it('matches a dining keyword within the purchase subtype', () => {
    // 'starbucks'/'coffee' are dining keywords; no earlier purchase category matches.
    expect(categorizeTransaction('STARBUCKS COFFEE', 'purchase')).toBe('dining');
  });

  it('first-match-wins by registration order (food → groceries, not dining)', () => {
    // 'food' is a groceries keyword; groceries is registered before dining.
    expect(categorizeTransaction('SWIGGY FOOD ORDER', 'purchase')).toBe('groceries');
  });

  it('matches the income category within the income subtype', () => {
    expect(categorizeTransaction('SALARY CREDIT PAYROLL', 'income')).toBe('income');
  });

  it('falls back to "other" when it is valid for the subtype and nothing matches', () => {
    expect(categorizeTransaction('???', 'purchase')).toBe('other');
  });

  it('falls back to the first valid category when "other" is not valid for the subtype', () => {
    // charge → [fees, taxes]; 'other' is not valid here, so default to the first.
    expect(categorizeTransaction('???', 'charge')).toBe('fees');
  });

  it('throws when no subtype is given (every Transaction must carry one)', () => {
    // A subtype is required. The no-subtype branch that used to scan the full
    // DEFAULT_CATEGORIES list is gone — it only ever returned arbitrary, often-wrong
    // categories on an input production never produces. Reaching here without a
    // subtype is a bug, so fail loudly.
    expect(() => categorizeTransaction('???')).toThrow(/transactionSubType/);
    expect(() => categorizeTransaction('grocery purchase')).toThrow(/transactionSubType/);
  });

  it('uses case-insensitive keyword matching', () => {
    expect(categorizeTransaction('GROCERY STORE', 'purchase')).toBe('groceries');
  });
});

describe('normalizeMerchantName', () => {
  it('strips UPI prefix', () => {
    expect(normalizeMerchantName('UPI/123456/AMAZON RETAIL')).toBe('Amazon');
  });

  it('strips NEFT prefix without substituting a bank brand', () => {
    // NEFT- is stripped. Banks are no longer in the merchant map (a bank is the
    // routing institution, not the payee), so "HDFC" is NOT substituted — the
    // cleaned narration is returned, retaining the transfer context. Asserting
    // the exact result catches both a broken prefix strip and a regressed bank
    // substitution.
    expect(normalizeMerchantName('NEFT-HDFC TRANSFER')).toBe('HDFC TRANSFER');
  });

  it('strips IMPS prefix', () => {
    // Exact: IMPS- is removed and RAZORPAY has no merchant-pattern mapping, so
    // the result is the stripped string itself — this is the assertion that
    // actually fails if the IMPS strip regresses.
    expect(normalizeMerchantName('IMPS-RAZORPAY')).toBe('RAZORPAY');
  });

  it('maps AMZN to Amazon', () => {
    expect(normalizeMerchantName('AMZN MARKETPLACE')).toBe('Amazon');
  });

  it('maps SWIGGY to Swiggy', () => {
    expect(normalizeMerchantName('SWIGGY ORDER')).toBe('Swiggy');
  });

  it('maps NETFLIX to Netflix', () => {
    expect(normalizeMerchantName('NETFLIX.COM')).toBe('Netflix');
  });

  it('maps SBUX to Starbucks', () => {
    expect(normalizeMerchantName('SBUX #12345')).toBe('Starbucks');
  });

  it('strips trailing reference numbers', () => {
    const result = normalizeMerchantName('MERCHANT NAME 123456');
    expect(result).not.toContain('123456');
  });

  it('strips asterisks', () => {
    const result = normalizeMerchantName('MERCHANT***NAME');
    expect(result).not.toContain('*');
  });

  it('returns cleaned description when no pattern matches', () => {
    const result = normalizeMerchantName('RANDOM MERCHANT ABC');
    expect(result).toBe('RANDOM MERCHANT ABC');
  });

  it('handles description that is all prefix noise', () => {
    // Exact: the POS card prefix is stripped, leaving the 4-digit reference
    // (trailing-number stripping only fires on 6+ digits, so 1234 survives).
    const result = normalizeMerchantName('POS 1234');
    expect(result).toBe('1234');
  });
});
