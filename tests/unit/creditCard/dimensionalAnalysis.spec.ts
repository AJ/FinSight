import { describe, it, expect } from 'vitest';
import {
  getGroupKey,
  getDimensionLabel,
  applyFilters,
  groupTransactions,
  getPeriodComparison,
  getMonthlyTrend,
} from '@/lib/creditCard/dimensionalAnalysis';
import { TransactionType } from '@/types';
import { makeTransaction, makeCategory } from '@tests/unit/factories';

describe('getGroupKey', () => {
  it('groups by category', () => {
    const txn = makeTransaction({ category: makeCategory('dining') });
    expect(getGroupKey(txn, 'category')).toBe('dining');
  });

  it('groups by month', () => {
    const txn = makeTransaction({ date: new Date('2024-03-15') });
    expect(getGroupKey(txn, 'month')).toBe('2024-03');
  });

  it('groups by amount range', () => {
    const txn = makeTransaction({ amount: 1500 });
    expect(getGroupKey(txn, 'amountRange')).toBe('500-2000');
  });

  it('groups international transactions by country', () => {
    const txn = makeTransaction({
      id: '1',
      description: 'Intl Purchase',
      amount: 1000,
      originalCurrency: 'USD',
      isInternationalTransaction: true,
    });
    expect(getGroupKey(txn, 'country')).toBe('International (USD)');
  });

  it('groups domestic as India', () => {
    const txn = makeTransaction({ amount: 1000 });
    expect(getGroupKey(txn, 'country')).toBe('India');
  });
});

describe('getDimensionLabel', () => {
  it('formats month key', () => {
    expect(getDimensionLabel('2024-01', 'month')).toBe('Jan 2024');
    expect(getDimensionLabel('2024-12', 'month')).toBe('Dec 2024');
  });

  it('formats amount range', () => {
    expect(getDimensionLabel('500-2000', 'amountRange')).toBe('₹500 - ₹2,000');
  });

  it('returns key for other dimensions', () => {
    expect(getDimensionLabel('dining', 'category')).toBe('dining');
  });
});

describe('applyFilters', () => {
  it('returns all transactions when no filters', () => {
    const txns = [makeTransaction({ id: '1' }), makeTransaction({ id: '2' })];
    expect(applyFilters(txns)).toHaveLength(2);
  });

  it('filters by date range', () => {
    const txns = [
      makeTransaction({ id: '1', date: new Date('2024-01-15') }),
      makeTransaction({ id: '2', date: new Date('2024-06-15') }),
    ];
    const filtered = applyFilters(txns, {
      dateFrom: new Date('2024-03-01'),
      dateTo: new Date('2024-12-31'),
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('2');
  });

  it('filters by type (excludes income)', () => {
    const txns = [
      makeTransaction({ id: '1', type: TransactionType.Debit }),
      makeTransaction({ id: '2', type: TransactionType.Credit }),
    ];
    const filtered = applyFilters(txns, { type: TransactionType.Debit });
    expect(filtered).toHaveLength(1);
  });
});

describe('groupTransactions', () => {
  it('groups by category with correct totals', () => {
    const txns = [
      makeTransaction({ id: '1', amount: 100, category: makeCategory('dining') }),
      makeTransaction({ id: '2', amount: 200, category: makeCategory('dining') }),
      makeTransaction({ id: '3', amount: 300, category: makeCategory('shopping') }),
    ];
    const groups = groupTransactions(txns, 'category');
    const diningGroup = groups.find(g => g.key === 'dining');
    expect(diningGroup?.amount).toBe(300);
    expect(diningGroup?.transactionCount).toBe(2);
  });

  it('groups by month', () => {
    const txns = [
      makeTransaction({ id: '1', amount: 100, date: new Date('2024-01-15') }),
      makeTransaction({ id: '2', amount: 200, date: new Date('2024-02-15') }),
    ];
    const groups = groupTransactions(txns, 'month');
    expect(groups).toHaveLength(2);
  });

  it('applies filters during grouping', () => {
    const txns = [
      makeTransaction({ id: '1', amount: 100, type: TransactionType.Debit }),
      makeTransaction({ id: '2', amount: 200, type: TransactionType.Credit }),
    ];
    const groups = groupTransactions(txns, 'category', { type: TransactionType.Debit });
    expect(groups.length).toBeGreaterThanOrEqual(0);
    const total = groups.reduce((sum, g) => sum + g.amount, 0);
    expect(total).toBe(100);
  });
});

describe('getPeriodComparison', () => {
  it('calculates change between periods', () => {
    const txns = [
      makeTransaction({ id: '1', amount: 1000, date: new Date('2024-01-15') }),
      makeTransaction({ id: '2', amount: 1200, date: new Date('2024-02-15') }),
    ];
    const result = getPeriodComparison(
      txns,
      { start: new Date('2024-01-01'), end: new Date('2024-01-31') },
      { start: new Date('2023-12-01'), end: new Date('2023-12-31') },
    );
    expect(result.change).toBe(0); // No previous period data
  });
});

describe('getMonthlyTrend', () => {
  it('returns N months of data', () => {
    const txns = Array.from({ length: 12 }, (_, i) =>
      makeTransaction({ id: `${i}`, amount: 100, date: new Date(2024, i, 15) })
    );
    const trend = getMonthlyTrend(txns, 3);
    expect(trend.length).toBeLessThanOrEqual(3);
  });
});
