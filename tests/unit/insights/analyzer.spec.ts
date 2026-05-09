import { describe, it, expect } from 'vitest';

import {
  groupByMonth,
  groupByCategory,
  groupByCategoryByMonth,
  groupByDayOfWeek,
  getTopMerchants,
  getTopCategories,
  getTransactionAnalytics,
  detectAnomalies,
} from '@/lib/insights/analyzer';
import { TransactionType, CategoryType } from '@/types';
import { makeTransaction, makeCategory } from '@tests/unit/factories';

describe('groupByMonth', () => {
  it('groups transactions by month correctly', () => {
    const txns = [
      makeTransaction({ id: '1', amount: 50000, type: TransactionType.Credit, date: new Date('2024-01-15'), category: makeCategory('income', CategoryType.Income) }),
      makeTransaction({ id: '2', amount: 12000, type: TransactionType.Debit, date: new Date('2024-01-20'), category: makeCategory('dining') }),
      makeTransaction({ id: '3', amount: 8000, type: TransactionType.Debit, date: new Date('2024-02-10'), category: makeCategory('dining') }),
    ];
    const result = groupByMonth(txns);
    expect(result['2024-01'].income).toBe(50000);
    expect(result['2024-01'].expenses).toBe(12000);
    expect(result['2024-02'].income).toBe(0);
    expect(result['2024-02'].expenses).toBe(8000);
  });

  it('handles empty array', () => {
    expect(groupByMonth([])).toEqual({});
  });
});

describe('groupByCategory', () => {
  it('aggregates by category', () => {
    const txns = [
      makeTransaction({ id: '1', amount: 100, category: makeCategory('dining') }),
      makeTransaction({ id: '2', amount: 200, category: makeCategory('dining') }),
      makeTransaction({ id: '3', amount: 300, category: makeCategory('dining') }),
    ];
    const result = groupByCategory(txns);
    expect(result.dining.total).toBe(600);
    expect(result.dining.count).toBe(3);
    expect(result.dining.avg).toBe(200);
  });
});

describe('groupByCategoryByMonth', () => {
  it('two-level grouping', () => {
    const txns = [
      makeTransaction({ id: '1', amount: 100, date: new Date('2024-01-15'), category: makeCategory('dining') }),
      makeTransaction({ id: '2', amount: 200, date: new Date('2024-02-15'), category: makeCategory('dining') }),
    ];
    const result = groupByCategoryByMonth(txns);
    expect(result.dining['2024-01']).toBe(100);
    expect(result.dining['2024-02']).toBe(200);
  });
});

describe('groupByDayOfWeek', () => {
  it('groups by day of week (0=Sunday)', () => {
    // Jan 15, 2024 = Monday (day 1), Jan 17 = Wednesday (day 3)
    const txns = [
      makeTransaction({ id: '1', amount: 100, date: new Date('2024-01-15') }),
      makeTransaction({ id: '2', amount: 200, date: new Date('2024-01-15') }),
      makeTransaction({ id: '3', amount: 300, date: new Date('2024-01-17') }),
    ];
    const result = groupByDayOfWeek(txns);
    expect(result[1].total).toBe(300); // Monday
    expect(result[1].count).toBe(2);
    expect(result[3].total).toBe(300); // Wednesday
    expect(result[3].count).toBe(1);
  });
});

describe('getTopMerchants', () => {
  it('returns top merchants by spending', () => {
    const txns = [
      makeTransaction({ id: '1', description: 'AMAZON', amount: 5000 }),
      makeTransaction({ id: '2', description: 'AMAZON', amount: 3000 }),
      makeTransaction({ id: '3', description: 'SWIGGY', amount: 2000 }),
    ];
    const result = getTopMerchants(txns);
    expect(result[0].name).toBe('AMAZON');
    expect(result[0].total).toBe(8000);
    expect(result[0].count).toBe(2);
  });

  it('respects limit parameter', () => {
    const txns = [
      makeTransaction({ id: '1', description: 'A', amount: 100 }),
      makeTransaction({ id: '2', description: 'B', amount: 200 }),
      makeTransaction({ id: '3', description: 'C', amount: 300 }),
    ];
    const result = getTopMerchants(txns, 1);
    expect(result).toHaveLength(1);
  });

  it('excludes income transactions', () => {
    const txns = [
      makeTransaction({ id: '1', description: 'AMAZON', amount: 100 }),
      makeTransaction({ id: '2', description: 'SALARY', amount: 50000, type: TransactionType.Credit, category: makeCategory('income', CategoryType.Income) }),
    ];
    const result = getTopMerchants(txns);
    expect(result.every(r => r.name !== 'SALARY')).toBe(true);
  });
});

describe('getTopCategories', () => {
  it('calculates percentages', () => {
    const byCategory = { dining: { total: 600, count: 3, avg: 200 }, groceries: { total: 400, count: 2, avg: 200 } };
    const result = getTopCategories(byCategory);
    expect(result[0].category).toBe('dining');
    expect(result[0].percentage).toBe(60);
    expect(result[1].percentage).toBe(40);
  });

  it('excludes income/transfer categories', () => {
    const byCategory = {
      dining: { total: 600, count: 3, avg: 200 },
      income: { total: 50000, count: 1, avg: 50000 },
    };
    const result = getTopCategories(byCategory);
    expect(result.every(r => r.category !== 'income')).toBe(true);
  });
});

describe('detectAnomalies (insights)', () => {
  it('returns empty for fewer than 5 expenses', () => {
    const txns = Array.from({ length: 3 }, (_, i) =>
      makeTransaction({ id: `${i}`, amount: 100 + i * 10 })
    );
    expect(detectAnomalies(txns)).toEqual([]);
  });

  it('returns empty when all amounts are same', () => {
    const txns = Array.from({ length: 5 }, (_, i) =>
      makeTransaction({ id: `${i}`, amount: 100 })
    );
    expect(detectAnomalies(txns)).toEqual([]);
  });
});

describe('getTransactionAnalytics', () => {
  it('returns full analytics object', () => {
    const txns = [
      makeTransaction({ id: '1', amount: 50000, type: TransactionType.Credit, date: new Date('2024-01-15'), category: makeCategory('income', CategoryType.Income) }),
      makeTransaction({ id: '2', amount: 12000, type: TransactionType.Debit, date: new Date('2024-01-20'), category: makeCategory('dining') }),
    ];
    const result = getTransactionAnalytics(txns);
    expect(result.totalTransactions).toBe(2);
    expect(result.byMonth['2024-01']).toBeDefined();
    expect(result.byMonth['2024-01'].income).toBe(50000);
    expect(result.byMonth['2024-01'].expenses).toBe(12000);
    expect(result.byCategory.dining).toBeDefined();
    expect(result.topMerchants.length).toBeGreaterThan(0);
  });

  it('returns empty analytics for zero transactions', () => {
    const result = getTransactionAnalytics([]);
    expect(result.totalTransactions).toBe(0);
    expect(result.byMonth).toEqual({});
    expect(result.byCategory).toEqual({});
  });
});
