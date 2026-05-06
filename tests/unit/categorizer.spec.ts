import { describe, it, expect } from 'vitest';

import { categorizeTransaction, normalizeMerchantName } from '@/lib/categorizer';
import { Category, CategoryType, TransactionType } from '@/models';

describe('categorizeTransaction', () => {
  const categories = [
    new Category('groceries', 'groceries', CategoryType.Expense, ['grocery', 'supermarket', 'bigbasket', 'swiggy']),
    new Category('dining', 'dining', CategoryType.Expense, ['restaurant', 'cafe', 'zomato']),
    new Category('salary', 'salary', CategoryType.Income, ['salary', 'wage', 'payroll']),
    new Category('transfer', 'transfer', CategoryType.Excluded),
  ];

  it('matches expense category by keyword', () => {
    const result = categorizeTransaction('SWIGGY FOOD ORDER', 350, categories);
    expect(result).toBe('groceries');
  });

  it('prefers category matching transaction type (debit prefers expense)', () => {
    const result = categorizeTransaction('restaurant bill', 500, categories, TransactionType.Debit);
    expect(result).toBe('dining');
  });

  it('falls back to other category type when preferred has no match', () => {
    const result = categorizeTransaction('salary credit', 50000, categories, TransactionType.Debit);
    expect(result).toBe('salary');
  });

  it('returns default category when no keywords match for debit', () => {
    const result = categorizeTransaction('unknown purchase', 100, categories);
    expect(result).toBe('other');
  });

  it('returns income default when no match for credit', () => {
    const result = categorizeTransaction('unknown credit', 100, categories, TransactionType.Credit);
    expect(result).toBe('salary');
  });

  it('handles empty description', () => {
    const result = categorizeTransaction('', 100, categories);
    expect(result).toBe('other');
  });

  it('handles empty categories array', () => {
    const result = categorizeTransaction('grocery purchase', 100, []);
    expect(result).toBe('other');
  });

  it('uses case-insensitive keyword matching', () => {
    const result = categorizeTransaction('GROCERY STORE', 100, categories);
    expect(result).toBe('groceries');
  });

  it('first-match-wins when keywords overlap', () => {
    // groceries registered before dining, and both could match some items
    const result = categorizeTransaction('swiggy order', 200, categories);
    expect(result).toBe('groceries');
  });
});

describe('normalizeMerchantName', () => {
  it('strips UPI prefix', () => {
    expect(normalizeMerchantName('UPI/123456/AMAZON RETAIL')).toBe('Amazon');
  });

  it('strips NEFT prefix', () => {
    expect(normalizeMerchantName('NEFT-HDFC TRANSFER')).toContain('HDFC');
  });

  it('strips IMPS prefix', () => {
    expect(normalizeMerchantName('IMPS-RAZORPAY')).toContain('RAZORPAY');
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
    const result = normalizeMerchantName('POS 1234');
    expect(result).toBeTruthy();
  });
});
