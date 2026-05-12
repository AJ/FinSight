import { describe, it, expect } from 'vitest';
import { startOfMonth, endOfMonth } from 'date-fns';
import {
  computePeriodRanges,
  filterCCTransactions,
  filterByPeriod,
  aggregateByCategory,
  computeChangePercent,
  getSortedCategoriesByCurrentSpend,
  formatPeriodLabel,
  computePeriodComparison,
  type TransactionLike,
  type PeriodData,
} from '@/components/creditCard/periodComparison';

function txn(overrides: Partial<TransactionLike> & { date: Date }): TransactionLike {
  return {
    sourceType: 'credit_card',
    isExpense: true,
    amount: 100,
    category: null,
    ...overrides,
  };
}

describe('computePeriodRanges', () => {
  it('computes ranges for 1 month', () => {
    const ref = new Date(2025, 2, 15);
    const { current, previous } = computePeriodRanges(1, ref);

    expect(current.start).toEqual(startOfMonth(ref));
    expect(current.end).toEqual(endOfMonth(ref));
    expect(previous.start).toEqual(new Date(2025, 1, 1));
    expect(previous.end).toEqual(endOfMonth(new Date(2025, 1, 1)));
  });

  it('computes ranges for 3 months', () => {
    const ref = new Date(2025, 2, 15);
    const { current, previous } = computePeriodRanges(3, ref);

    expect(current.start).toEqual(new Date(2025, 0, 1));
    expect(current.end).toEqual(endOfMonth(ref));
    expect(previous.start).toEqual(new Date(2024, 9, 1));
    expect(previous.end).toEqual(endOfMonth(new Date(2024, 11, 1)));
  });

  it('computes ranges for 6 months', () => {
    const ref = new Date(2025, 5, 15);
    const { current, previous } = computePeriodRanges(6, ref);

    expect(current.start).toEqual(new Date(2025, 0, 1));
    expect(current.end).toEqual(endOfMonth(ref));
    expect(previous.start).toEqual(new Date(2024, 6, 1));
    expect(previous.end).toEqual(endOfMonth(new Date(2024, 11, 1)));
  });

  it('defaults to now when no reference date given', () => {
    const { current } = computePeriodRanges(1);
    const now = new Date();

    expect(current.start.getDate()).toBe(1);
    expect(current.end.getMonth()).toBe(now.getMonth());
  });
});

describe('filterCCTransactions', () => {
  it('keeps only CC expenses', () => {
    const txns = [
      txn({ date: new Date('2025-03-01'), sourceType: 'credit_card', isExpense: true, amount: 100 }),
      txn({ date: new Date('2025-03-01'), sourceType: 'credit_card', isExpense: false, amount: 50 }),
      txn({ date: new Date('2025-03-01'), sourceType: 'bank', isExpense: true, amount: 200 }),
    ];

    const result = filterCCTransactions(txns);
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(100);
  });

  it('returns empty for no CC transactions', () => {
    const txns = [
      txn({ date: new Date('2025-03-01'), sourceType: 'bank', isExpense: true, amount: 100 }),
    ];

    expect(filterCCTransactions(txns)).toHaveLength(0);
  });
});

describe('filterByPeriod', () => {
  const txns = [
    txn({ date: new Date('2025-01-15'), amount: 100 }),
    txn({ date: new Date('2025-02-15'), amount: 200 }),
    txn({ date: new Date('2025-03-15'), amount: 300 }),
  ];

  it('filters transactions within date range', () => {
    const result = filterByPeriod(txns, new Date('2025-02-01'), new Date('2025-02-28'));
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(200);
  });

  it('includes boundary dates', () => {
    const result = filterByPeriod(txns, new Date('2025-01-15'), new Date('2025-01-15'));
    expect(result).toHaveLength(1);
  });

  it('returns empty when no transactions in range', () => {
    const result = filterByPeriod(txns, new Date('2025-04-01'), new Date('2025-04-30'));
    expect(result).toHaveLength(0);
  });

  it('handles non-Date date values', () => {
    const txnsWithString = [
      txn({ date: new Date('2025-02-10'), amount: 50 }),
    ];
    const result = filterByPeriod(txnsWithString, new Date('2025-02-01'), new Date('2025-02-28'));
    expect(result).toHaveLength(1);
  });
});

describe('aggregateByCategory', () => {
  it('aggregates totals by category', () => {
    const txns = [
      txn({ date: new Date('2025-03-01'), amount: 100, category: { id: 'food' } }),
      txn({ date: new Date('2025-03-01'), amount: 200, category: { id: 'food' } }),
      txn({ date: new Date('2025-03-01'), amount: 150, category: { id: 'transport' } }),
    ];

    const result = aggregateByCategory(txns);
    expect(result.total).toBe(450);
    expect(result.byCategory.get('food')).toBe(300);
    expect(result.byCategory.get('transport')).toBe(150);
  });

  it('uses "uncategorized" for missing category', () => {
    const txns = [
      txn({ date: new Date('2025-03-01'), amount: 100, category: null }),
    ];

    const result = aggregateByCategory(txns);
    expect(result.byCategory.get('uncategorized')).toBe(100);
  });

  it('returns zero total for empty input', () => {
    const result = aggregateByCategory([]);
    expect(result.total).toBe(0);
    expect(result.byCategory.size).toBe(0);
  });

  it('uses absolute value of amounts', () => {
    const txns = [
      txn({ date: new Date('2025-03-01'), amount: -100, category: { id: 'food' } }),
    ];

    const result = aggregateByCategory(txns);
    expect(result.total).toBe(100);
  });
});

describe('computeChangePercent', () => {
  it('computes positive change', () => {
    expect(computeChangePercent(150, 100)).toBe(50);
  });

  it('computes negative change', () => {
    expect(computeChangePercent(50, 100)).toBe(-50);
  });

  it('returns 0 when previous is 0', () => {
    expect(computeChangePercent(100, 0)).toBe(0);
  });

  it('returns 0 when both are 0', () => {
    expect(computeChangePercent(0, 0)).toBe(0);
  });

  it('returns 0 when both are equal', () => {
    expect(computeChangePercent(100, 100)).toBe(0);
  });
});

describe('getSortedCategoriesByCurrentSpend', () => {
  it('merges categories from both periods sorted by current amount desc', () => {
    const current: PeriodData = {
      total: 300,
      byCategory: new Map([['food', 200], ['transport', 100]]),
    };
    const previous: PeriodData = {
      total: 250,
      byCategory: new Map([['food', 150], ['entertainment', 100]]),
    };

    const result = getSortedCategoriesByCurrentSpend(current, previous);
    expect(result).toEqual(['food', 'transport', 'entertainment']);
  });

  it('handles empty current period', () => {
    const current: PeriodData = { total: 0, byCategory: new Map() };
    const previous: PeriodData = {
      total: 100,
      byCategory: new Map([['food', 100]]),
    };

    const result = getSortedCategoriesByCurrentSpend(current, previous);
    expect(result).toEqual(['food']);
  });

  it('handles empty previous period', () => {
    const current: PeriodData = {
      total: 100,
      byCategory: new Map([['food', 100]]),
    };
    const previous: PeriodData = { total: 0, byCategory: new Map() };

    const result = getSortedCategoriesByCurrentSpend(current, previous);
    expect(result).toEqual(['food']);
  });

  it('handles both empty', () => {
    const current: PeriodData = { total: 0, byCategory: new Map() };
    const previous: PeriodData = { total: 0, byCategory: new Map() };

    expect(getSortedCategoriesByCurrentSpend(current, previous)).toEqual([]);
  });
});

describe('formatPeriodLabel', () => {
  it('formats single month as "MMM yyyy"', () => {
    const result = formatPeriodLabel(new Date('2025-03-01'), new Date('2025-03-31'));
    expect(result).toBe('Mar 2025');
  });

  it('formats multi-month as "MMM yyyy - MMM yyyy"', () => {
    const result = formatPeriodLabel(new Date('2025-01-01'), new Date('2025-03-31'));
    expect(result).toBe('Jan 2025 - Mar 2025');
  });

  it('formats same month different year', () => {
    const result = formatPeriodLabel(new Date('2024-03-01'), new Date('2025-03-31'));
    expect(result).toBe('Mar 2024 - Mar 2025');
  });
});

describe('computePeriodComparison', () => {
  it('computes full comparison across two periods', () => {
    const txns = [
      // Current period (Mar 2025) CC expenses
      txn({ date: new Date('2025-03-10'), amount: 500, category: { id: 'food' } }),
      txn({ date: new Date('2025-03-15'), amount: 300, category: { id: 'transport' } }),
      // Previous period (Feb 2025) CC expenses
      txn({ date: new Date('2025-02-10'), amount: 400, category: { id: 'food' } }),
      txn({ date: new Date('2025-02-15'), amount: 200, category: { id: 'entertainment' } }),
      // Bank expense — should be excluded
      txn({ date: new Date('2025-03-10'), sourceType: 'bank', amount: 1000 }),
    ];

    const result = computePeriodComparison(txns, 1, new Date(2025, 2, 15));

    expect(result.currentData.total).toBe(800);
    expect(result.previousData.total).toBe(600);
    expect(result.change).toBeCloseTo(33.33);
    expect(result.sortedCategories).toEqual(['food', 'transport', 'entertainment']);
  });

  it('returns zero change for empty previous period', () => {
    const txns = [
      txn({ date: new Date('2025-03-10'), amount: 500, category: { id: 'food' } }),
    ];

    const result = computePeriodComparison(txns, 1, new Date(2025, 2, 15));

    expect(result.currentData.total).toBe(500);
    expect(result.previousData.total).toBe(0);
    expect(result.change).toBe(0);
  });

  it('returns empty results for no CC transactions', () => {
    const txns = [
      txn({ date: new Date('2025-03-10'), sourceType: 'bank', amount: 500 }),
    ];

    const result = computePeriodComparison(txns, 1, new Date(2025, 2, 15));

    expect(result.currentData.total).toBe(0);
    expect(result.previousData.total).toBe(0);
    expect(result.change).toBe(0);
    expect(result.sortedCategories).toEqual([]);
  });

  it('includes period ranges in result', () => {
    const ref = new Date(2025, 2, 15);
    const result = computePeriodComparison([], 1, ref);

    expect(result.currentPeriod.start).toEqual(startOfMonth(ref));
    expect(result.currentPeriod.end).toEqual(endOfMonth(ref));
    expect(result.previousPeriod.start).toEqual(new Date(2025, 1, 1));
    expect(result.previousPeriod.end).toEqual(endOfMonth(new Date(2025, 1, 1)));
  });
});
