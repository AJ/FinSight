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

  it('falls back to "uncategorized" when category is missing (null)', () => {
    const txn = makeTransaction({ id: '1', amount: 500 });
    // Explicitly set category to null to simulate missing category
    txn.category = null as unknown as import('@/types').Category;
    const result = groupByCategory([txn]);
    expect(result['uncategorized']).toBeDefined();
    expect(result['uncategorized'].total).toBe(500);
    expect(result['uncategorized'].count).toBe(1);
  });

  it('returns empty object for empty input', () => {
    expect(groupByCategory([])).toEqual({});
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

  it('excludes income transactions', () => {
    const txns = [
      makeTransaction({ id: '1', amount: 1000, date: new Date('2024-01-15'), category: makeCategory('dining') }),
      makeTransaction({ id: '2', amount: 50000, date: new Date('2024-01-15'), type: TransactionType.Credit, category: makeCategory('income', CategoryType.Income) }),
    ];
    const result = groupByCategoryByMonth(txns);
    expect(result.dining['2024-01']).toBe(1000);
    expect(result.income).toBeUndefined();
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

  it('excludes income transactions', () => {
    // Jan 15, 2024 = Monday (day 1)
    const txns = [
      makeTransaction({ id: '1', amount: 500, date: new Date('2024-01-15') }),
      makeTransaction({ id: '2', amount: 50000, date: new Date('2024-01-15'), type: TransactionType.Credit, category: makeCategory('income', CategoryType.Income) }),
    ];
    const result = groupByDayOfWeek(txns);
    // Monday should only have the expense, not the income
    expect(result[1].total).toBe(500);
    expect(result[1].count).toBe(1);
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

  it('prefers merchant field over description when set', () => {
    const txns = [
      makeTransaction({ id: '1', description: 'POS PURCHASE 12345', amount: 500, merchant: 'AMAZON' }),
    ];
    const result = getTopMerchants(txns);
    expect(result[0].name).toBe('AMAZON');
  });

  it('truncates long description to 30 chars when no merchant set', () => {
    const longDescription = 'A VERY LONG MERCHANT NAME THAT EXCEEDS THIRTY CHARACTERS';
    const txns = [
      makeTransaction({ id: '1', description: longDescription, amount: 500 }),
    ];
    const result = getTopMerchants(txns);
    expect(result[0].name).toBe(longDescription.slice(0, 30));
    expect(result[0].name.length).toBe(30);
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

  it('respects limit parameter', () => {
    const byCategory = {
      dining: { total: 600, count: 3, avg: 200 },
      groceries: { total: 400, count: 2, avg: 200 },
      transport: { total: 200, count: 1, avg: 200 },
    };
    const result = getTopCategories(byCategory, 2);
    expect(result).toHaveLength(2);
    expect(result[0].category).toBe('dining');
    expect(result[1].category).toBe('groceries');
  });

  it('returns empty when totalExpenses is 0 (only income/transfer categories)', () => {
    const byCategory = {
      income: { total: 50000, count: 1, avg: 50000 },
      transfer: { total: 10000, count: 1, avg: 10000 },
    };
    const result = getTopCategories(byCategory);
    expect(result).toEqual([]);
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

  it('detects z-score anomalies with 5+ varying expenses', () => {
    // 6 normal expenses at 100, 1 outlier at 5000
    // mean = (6*100 + 5000) / 7 = 800
    // variance = (6*(100-800)^2 + (5000-800)^2) / 7 = (6*490000 + 17640000) / 7 = 20571428.57 / 7 ... let me compute:
    // Actually: 6*(100-800)^2 = 6*490000 = 2940000, (5000-800)^2 = 17640000
    // variance = (2940000 + 17640000) / 7 = 2940000
    // stdDev = sqrt(2940000) ≈ 1714.65
    // z-score for 100: (100-800)/1714.65 ≈ -0.41 (not anomaly)
    // z-score for 5000: (5000-800)/1714.65 ≈ 2.45 (anomaly)
    const txns = [
      ...Array.from({ length: 6 }, (_, i) =>
        makeTransaction({ id: `norm-${i}`, amount: 100, description: `Normal ${i}` })
      ),
      makeTransaction({ id: 'outlier-1', amount: 5000, description: 'Big Purchase' }),
    ];

    const result = detectAnomalies(txns);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].description).toBe('Big Purchase');
    expect(result[0].amount).toBe(5000);
    expect(result[0].zScore).toBeGreaterThan(2);
  });

  it('sorts anomalies by z-score descending and caps at 5', () => {
    // 50 base expenses at 100, 7 outliers at 70000-130000
    // With population z-scores, 6 of the 7 outliers exceed z=2.
    // The function caps results at 5, sorted by descending z-score.
    const base = Array.from({ length: 50 }, (_, i) =>
      makeTransaction({ id: `base-${i}`, amount: 100, description: `Base ${i}` })
    );
    const outlierAmounts = [70000, 80000, 90000, 100000, 110000, 120000, 130000];
    const outliers = outlierAmounts.map((amt, i) =>
      makeTransaction({ id: `out-${i}`, amount: amt, description: `Outlier ${i}` })
    );

    const result = detectAnomalies([...base, ...outliers]);

    // Should be capped at 5 even though 6+ exceed the threshold
    expect(result.length).toBe(5);
    // Should be sorted descending by zScore (highest first)
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].zScore).toBeGreaterThanOrEqual(result[i].zScore);
    }
    // All returned should have zScore > 2
    for (const anomaly of result) {
      expect(anomaly.zScore).toBeGreaterThan(2);
    }
  });

  it('rounds z-score to 2 decimal places', () => {
    // Use amounts that produce a non-terminating z-score
    const txns = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeTransaction({ id: `norm-${i}`, amount: 100, description: `Normal ${i}` })
      ),
      makeTransaction({ id: 'outlier', amount: 5000, description: 'Big Purchase' }),
    ];

    const result = detectAnomalies(txns);
    const outlier = result.find(r => r.description === 'Big Purchase');
    expect(outlier).toBeDefined();

    // Verify z-score has at most 2 decimal places
    const zStr = String(outlier!.zScore);
    const decimalPart = zStr.split('.')[1];
    if (decimalPart) {
      expect(decimalPart.length).toBeLessThanOrEqual(2);
    }
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

  it('asserts all computed fields', () => {
    const txns = [
      makeTransaction({ id: '1', amount: 50000, type: TransactionType.Credit, date: new Date('2024-01-15'), category: makeCategory('income', CategoryType.Income) }),
      makeTransaction({ id: '2', amount: 12000, type: TransactionType.Debit, date: new Date('2024-01-20'), category: makeCategory('dining') }),
      makeTransaction({ id: '3', amount: 8000, type: TransactionType.Debit, date: new Date('2024-02-10'), category: makeCategory('dining') }),
    ];
    const result = getTransactionAnalytics(txns);

    // dateRange
    expect(result.dateRange.start).toBe('2024-01-15');
    expect(result.dateRange.end).toBe('2024-02-10');

    // anomalies — only 2 expenses, so should be empty (< 5 threshold)
    expect(result.anomalies).toEqual([]);

    // topCategories
    expect(result.topCategories.length).toBeGreaterThan(0);
    expect(result.topCategories[0].category).toBe('dining');

    // byDayOfWeek — always has 7 entries
    expect(Object.keys(result.byDayOfWeek)).toHaveLength(7);

    // byCategoryByMonth — dining should have entries for both months
    expect(result.byCategoryByMonth.dining).toBeDefined();
    expect(result.byCategoryByMonth.dining['2024-01']).toBe(12000);
    expect(result.byCategoryByMonth.dining['2024-02']).toBe(8000);

    // currentMonth / previousMonth — will be { income: 0, expenses: 0 } since dates are in 2024
    expect(result.currentMonth).toBeDefined();
    expect(typeof result.currentMonth.income).toBe('number');
    expect(typeof result.currentMonth.expenses).toBe('number');
    expect(result.previousMonth).toBeDefined();
    expect(typeof result.previousMonth.income).toBe('number');
    expect(typeof result.previousMonth.expenses).toBe('number');

    // threeMonthAvg
    expect(result.threeMonthAvg).toBeDefined();
    expect(typeof result.threeMonthAvg.income).toBe('number');
    expect(typeof result.threeMonthAvg.expenses).toBe('number');
  });

  it('returns empty analytics for zero transactions', () => {
    const result = getTransactionAnalytics([]);
    expect(result.totalTransactions).toBe(0);
    expect(result.byMonth).toEqual({});
    expect(result.byCategory).toEqual({});
  });
});
