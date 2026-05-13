import { describe, it, expect } from 'vitest';
import {
  aggregateSpendingByCategory,
  classifyBudgetStatus,
  computeBudgetProgress,
  computeSummaryTotals,
  getStatusDisplay,
  computeAllocationSummary,
  type TransactionLike,
  type PeriodLike,
} from '@/lib/budget/progressCalculation';

function makeTxn(overrides: Partial<TransactionLike> & { category: { id: string } }): TransactionLike {
  return {
    isExpense: true,
    date: new Date('2026-04-10'),
    amount: 100,
    ...overrides,
  };
}

describe('aggregateSpendingByCategory', () => {
  it('returns empty record for no transactions', () => {
    const result = aggregateSpendingByCategory([], '2026-04');
    expect(result).toEqual({});
  });

  it('aggregates expenses by category for the target month', () => {
    const txns: TransactionLike[] = [
      makeTxn({ category: { id: 'groceries' }, amount: 500 }),
      makeTxn({ category: { id: 'groceries' }, amount: 300 }),
      makeTxn({ category: { id: 'dining' }, amount: 200 }),
    ];

    const result = aggregateSpendingByCategory(txns, '2026-04');

    expect(result).toEqual({ groceries: 800, dining: 200 });
  });

  it('ignores non-expense transactions', () => {
    const txns: TransactionLike[] = [
      makeTxn({ category: { id: 'salary' }, amount: 50000, isExpense: false }),
      makeTxn({ category: { id: 'groceries' }, amount: 500 }),
    ];

    const result = aggregateSpendingByCategory(txns, '2026-04');

    expect(result).toEqual({ groceries: 500 });
  });

  it('ignores transactions from other months', () => {
    const txns: TransactionLike[] = [
      makeTxn({ category: { id: 'groceries' }, amount: 500, date: new Date('2026-03-15') }),
      makeTxn({ category: { id: 'groceries' }, amount: 300, date: new Date('2026-04-10') }),
    ];

    const result = aggregateSpendingByCategory(txns, '2026-04');

    expect(result).toEqual({ groceries: 300 });
  });

  it('uses absolute values for amounts', () => {
    const txns: TransactionLike[] = [
      makeTxn({ category: { id: 'groceries' }, amount: -250 }),
    ];

    const result = aggregateSpendingByCategory(txns, '2026-04');

    expect(result).toEqual({ groceries: 250 });
  });
});

describe('classifyBudgetStatus', () => {
  it('returns "on-track" when under 80%', () => {
    expect(classifyBudgetStatus(10000, 5000, 50)).toBe('on-track');
    expect(classifyBudgetStatus(10000, 7949, 79)).toBe('on-track');
  });

  it('returns "warning" at 80% and up to 99%', () => {
    expect(classifyBudgetStatus(10000, 8000, 80)).toBe('warning');
    expect(classifyBudgetStatus(10000, 9900, 99)).toBe('warning');
  });

  it('returns "over-budget" at 100% and above', () => {
    expect(classifyBudgetStatus(10000, 10000, 100)).toBe('over-budget');
    expect(classifyBudgetStatus(10000, 15000, 150)).toBe('over-budget');
  });

  it('returns "not-set" when budgeted is 0 and there is spending', () => {
    expect(classifyBudgetStatus(0, 500, 0)).toBe('not-set');
  });

  it('returns "on-track" when budgeted is 0 and no spending', () => {
    expect(classifyBudgetStatus(0, 0, 0)).toBe('on-track');
  });
});

describe('computeBudgetProgress', () => {
  it('returns empty array for null period and no spending', () => {
    const result = computeBudgetProgress(null, [], '2026-04');
    expect(result).toEqual([]);
  });

  it('returns progress entries for allocated categories with no spending', () => {
    const period: PeriodLike = {
      allocations: [
        { categoryId: 'groceries', amount: 10000 },
        { categoryId: 'dining', amount: 5000 },
      ],
    };

    const result = computeBudgetProgress(period, [], '2026-04');

    expect(result).toHaveLength(2);
    const groceries = result.find(r => r.categoryId === 'groceries')!;
    expect(groceries.budgeted).toBe(10000);
    expect(groceries.spent).toBe(0);
    expect(groceries.remaining).toBe(10000);
    expect(groceries.percentUsed).toBe(0);
    expect(groceries.status).toBe('on-track');
  });

  it('computes spent, remaining, percentUsed for budgeted categories', () => {
    const period: PeriodLike = {
      allocations: [{ categoryId: 'groceries', amount: 10000 }],
    };
    const txns: TransactionLike[] = [
      makeTxn({ category: { id: 'groceries' }, amount: 3000 }),
      makeTxn({ category: { id: 'groceries' }, amount: 2000 }),
    ];

    const result = computeBudgetProgress(period, txns, '2026-04');
    const groceries = result.find(r => r.categoryId === 'groceries')!;

    expect(groceries.spent).toBe(5000);
    expect(groceries.remaining).toBe(5000);
    expect(groceries.percentUsed).toBe(50);
    expect(groceries.status).toBe('on-track');
  });

  it('includes unbudgeted categories from spending', () => {
    const txns: TransactionLike[] = [
      makeTxn({ category: { id: 'dining' }, amount: 3000 }),
    ];

    const result = computeBudgetProgress(null, txns, '2026-04');
    const dining = result.find(r => r.categoryId === 'dining')!;

    expect(dining.budgeted).toBe(0);
    expect(dining.spent).toBe(3000);
    expect(dining.remaining).toBe(-3000);
    expect(dining.status).toBe('not-set');
  });

  it('deduplicates categories present in both allocations and spending', () => {
    const period: PeriodLike = {
      allocations: [{ categoryId: 'groceries', amount: 10000 }],
    };
    const txns: TransactionLike[] = [
      makeTxn({ category: { id: 'groceries' }, amount: 7000 }),
    ];

    const result = computeBudgetProgress(period, txns, '2026-04');

    expect(result).toHaveLength(1);
    expect(result[0].categoryId).toBe('groceries');
  });

  it('computes negative remaining when over budget', () => {
    const period: PeriodLike = {
      allocations: [{ categoryId: 'groceries', amount: 5000 }],
    };
    const txns: TransactionLike[] = [
      makeTxn({ category: { id: 'groceries' }, amount: 8000 }),
    ];

    const result = computeBudgetProgress(period, txns, '2026-04');
    const groceries = result.find(r => r.categoryId === 'groceries')!;

    expect(groceries.remaining).toBe(-3000);
    expect(groceries.percentUsed).toBe(160);
    expect(groceries.status).toBe('over-budget');
  });

  it('handles empty period allocations', () => {
    const period: PeriodLike = { allocations: [] };
    const result = computeBudgetProgress(period, [], '2026-04');
    expect(result).toEqual([]);
  });

  it('handles explicit zero-amount allocation with spending', () => {
    const period: PeriodLike = {
      allocations: [{ categoryId: 'groceries', amount: 0 }],
    };
    const txns: TransactionLike[] = [
      makeTxn({ category: { id: 'groceries' }, amount: 500 }),
    ];

    const result = computeBudgetProgress(period, txns, '2026-04');
    const groceries = result.find(r => r.categoryId === 'groceries')!;

    expect(groceries.budgeted).toBe(0);
    expect(groceries.spent).toBe(500);
    expect(groceries.status).toBe('not-set');
  });

  it('handles zero-amount expense transaction', () => {
    const txns: TransactionLike[] = [
      makeTxn({ category: { id: 'groceries' }, amount: 0 }),
    ];

    const result = computeBudgetProgress(null, txns, '2026-04');
    const groceries = result.find(r => r.categoryId === 'groceries')!;

    expect(groceries.spent).toBe(0);
  });
});

describe('computeSummaryTotals', () => {
  it('aggregates budgeted, spent, remaining from progress entries', () => {
    const progress = [
      { categoryId: 'a', budgeted: 10000, spent: 5000, remaining: 5000, percentUsed: 50, status: 'on-track' as const },
      { categoryId: 'b', budgeted: 8000, spent: 8000, remaining: 0, percentUsed: 100, status: 'over-budget' as const },
    ];

    const result = computeSummaryTotals(progress, 60000);

    expect(result.budgeted).toBe(18000);
    expect(result.spent).toBe(13000);
    expect(result.remaining).toBe(5000);
    expect(result.income).toBe(60000);
  });

  it('returns zeros for empty progress', () => {
    const result = computeSummaryTotals([], null);
    expect(result.budgeted).toBe(0);
    expect(result.spent).toBe(0);
    expect(result.remaining).toBe(0);
    expect(result.income).toBeNull();
  });
});

describe('getStatusDisplay', () => {
  it('returns display info for each status', () => {
    const onTrack = getStatusDisplay('on-track');
    expect(onTrack.label).toBe('On Track');
    expect(onTrack.className).toBeTruthy();

    const warning = getStatusDisplay('warning');
    expect(warning.label).toBe('Warning');

    const over = getStatusDisplay('over-budget');
    expect(over.label).toBe('Over');

    const notSet = getStatusDisplay('not-set');
    expect(notSet.label).toBe('No budget');
  });
});

describe('computeAllocationSummary', () => {
  it('computes totals for allocations within budget', () => {
    const result = computeAllocationSummary(50000, { groceries: 15000, dining: 10000 });

    expect(result.totalAllocated).toBe(25000);
    expect(result.unallocated).toBe(25000);
    expect(result.allocPct).toBe(50);
    expect(result.isOverAllocated).toBe(false);
  });

  it('detects over-allocation', () => {
    const result = computeAllocationSummary(10000, { groceries: 8000, dining: 5000 });

    expect(result.totalAllocated).toBe(13000);
    expect(result.unallocated).toBe(-3000);
    expect(result.allocPct).toBe(130);
    expect(result.isOverAllocated).toBe(true);
  });

  it('handles zero income', () => {
    const result = computeAllocationSummary(0, { groceries: 5000 });

    expect(result.allocPct).toBe(0);
    expect(result.isOverAllocated).toBe(true);
  });

  it('handles empty allocations', () => {
    const result = computeAllocationSummary(50000, {});

    expect(result.totalAllocated).toBe(0);
    expect(result.unallocated).toBe(50000);
    expect(result.allocPct).toBe(0);
    expect(result.isOverAllocated).toBe(false);
  });
});
