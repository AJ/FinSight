import { describe, it, expect } from 'vitest';
import { forecastCategorySpending, calculateMedianMonthlyIncome, calculateAverageMonthlyIncome } from '@/lib/forecaster';
import { makeTransaction } from '@tests/unit/factories';
import { Category } from '@/models';
import '@/lib/categorization/categories';

describe('forecastCategorySpending (median)', () => {
  it('returns 0 for no transactions', () => {
    expect(forecastCategorySpending([], 'groceries')).toBe(0);
  });

  it('returns median of monthly sums for a category', () => {
    const groceries = Category.fromId('groceries')!;
    const txns = [
      makeTransaction({ description: 'a', amount: 300, date: '2026-01-15', category: groceries }),
      makeTransaction({ description: 'b', amount: 500, date: '2026-02-15', category: groceries }),
      makeTransaction({ description: 'c', amount: 100, date: '2026-03-15', category: groceries }),
    ];

    const result = forecastCategorySpending(txns, 'groceries', 3);
    // Monthly sums: Jan=300, Feb=500, Mar=100. Sorted: [100, 300, 500]. Median: 300
    expect(result).toBe(300);
  });

  it('returns median of even count (average of two middle values)', () => {
    const groceries = Category.fromId('groceries')!;
    const txns = [
      makeTransaction({ description: 'a', amount: 100, date: '2026-01-15', category: groceries }),
      makeTransaction({ description: 'b', amount: 200, date: '2026-02-15', category: groceries }),
      makeTransaction({ description: 'c', amount: 300, date: '2026-03-15', category: groceries }),
      makeTransaction({ description: 'd', amount: 400, date: '2026-04-15', category: groceries }),
    ];

    const result = forecastCategorySpending(txns, 'groceries', 4);
    // Monthly sums: Jan=100, Feb=200, Mar=300, Apr=400. Sorted: [100, 200, 300, 400]. Median: (200+300)/2 = 250
    expect(result).toBe(250);
  });

  it('ignores transactions from other categories', () => {
    const groceries = Category.fromId('groceries')!;
    const dining = Category.fromId('dining')!;
    const txns = [
      makeTransaction({ description: 'grocery', amount: 300, date: '2026-01-15', category: groceries }),
      makeTransaction({ description: 'dinner', amount: 500, date: '2026-01-15', category: dining }),
    ];

    const result = forecastCategorySpending(txns, 'groceries', 3);
    // Only groceries: Jan=300. One month of data. Median of [300] = 300
    expect(result).toBe(300);
  });

  it('aggregates multiple transactions in the same month', () => {
    const groceries = Category.fromId('groceries')!;
    const txns = [
      makeTransaction({ description: 'a', amount: 100, date: '2026-01-05', category: groceries }),
      makeTransaction({ description: 'b', amount: 200, date: '2026-01-20', category: groceries }),
      makeTransaction({ description: 'c', amount: 600, date: '2026-02-10', category: groceries }),
      makeTransaction({ description: 'd', amount: 400, date: '2026-03-05', category: groceries }),
    ];

    const result = forecastCategorySpending(txns, 'groceries', 3);
    // Monthly sums: Jan=300, Feb=600, Mar=400. Sorted: [300, 400, 600]. Median: 400
    expect(result).toBe(400);
  });

  it('ignores transactions outside the lookback window', () => {
    const groceries = Category.fromId('groceries')!;
    const txns = [
      makeTransaction({ description: 'a', amount: 1000, date: '2025-01-15', category: groceries }),
      makeTransaction({ description: 'b', amount: 200, date: '2026-03-15', category: groceries }),
    ];

    const result = forecastCategorySpending(txns, 'groceries', 3);
    // Only Mar=200 within window. Median of [200] = 200
    expect(result).toBe(200);
  });
});

describe('calculateMedianMonthlyIncome', () => {
  it('returns 0 for no income transactions', () => {
    expect(calculateMedianMonthlyIncome([])).toBe(0);
  });

  it('returns median monthly income', () => {
    const income = Category.fromId('income')!;
    const txns = [
      makeTransaction({ description: 'sal', amount: 50000, date: '2026-01-01', type: 'credit', category: income }),
      makeTransaction({ description: 'sal', amount: 60000, date: '2026-02-01', type: 'credit', category: income }),
      makeTransaction({ description: 'sal', amount: 40000, date: '2026-03-01', type: 'credit', category: income }),
    ];

    const result = calculateMedianMonthlyIncome(txns, 3);
    // Monthly sums: Jan=50000, Feb=60000, Mar=40000. Sorted: [40000, 50000, 60000]. Median: 50000
    expect(result).toBe(50000);
  });
});

describe('calculateAverageMonthlyIncome (deprecated alias)', () => {
  it('still works as a function', () => {
    expect(typeof calculateAverageMonthlyIncome).toBe('function');
  });

  it('returns the same value as calculateMedianMonthlyIncome', () => {
    const income = Category.fromId('income')!;
    const txns = [
      makeTransaction({ description: 'sal', amount: 50000, date: '2026-01-01', type: 'credit', category: income }),
      makeTransaction({ description: 'sal', amount: 60000, date: '2026-02-01', type: 'credit', category: income }),
    ];

    expect(calculateAverageMonthlyIncome(txns, 3)).toBe(calculateMedianMonthlyIncome(txns, 3));
  });
});
