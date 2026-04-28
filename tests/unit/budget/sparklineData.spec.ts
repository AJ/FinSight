import { describe, it, expect } from 'vitest';
import { computeSparklineData } from '@/lib/budget/sparklineData';
import { makeTransaction, makeCategory } from '@tests/unit/factories';
import { CategoryType } from '@/models';
import '@/lib/categorization/categories';

const groceriesId = 'groceries';
const diningId = 'dining';

describe('computeSparklineData', () => {
  it('returns 5 points by default in chronological order', () => {
    const ref = new Date('2026-04-15');

    const result = computeSparklineData([], groceriesId, 5, ref);

    expect(result).toHaveLength(5);
    const months = result.map(p => p.month);
    expect(months).toEqual(['2025-12', '2026-01', '2026-02', '2026-03', '2026-04']);
  });

  it('aggregates spending per month for category', () => {
    const ref = new Date('2026-04-01');
    const transactions = [
      makeTransaction({ category: makeCategory(groceriesId, CategoryType.Expense), amount: 100, date: new Date('2026-01-10') }),
      makeTransaction({ category: makeCategory(groceriesId, CategoryType.Expense), amount: 200, date: new Date('2026-01-20') }),
      makeTransaction({ category: makeCategory(groceriesId, CategoryType.Expense), amount: 300, date: new Date('2026-02-05') }),
    ];

    const result = computeSparklineData(transactions, groceriesId, 5, ref);

    const jan = result.find(p => p.month === '2026-01')!;
    const feb = result.find(p => p.month === '2026-02')!;
    const dec = result.find(p => p.month === '2025-12')!;
    const mar = result.find(p => p.month === '2026-03')!;
    const apr = result.find(p => p.month === '2026-04')!;

    expect(jan.amount).toBe(300);
    expect(feb.amount).toBe(300);
    expect(dec.amount).toBe(0);
    expect(mar.amount).toBe(0);
    expect(apr.amount).toBe(0);
  });

  it('ignores other categories', () => {
    const ref = new Date('2026-04-01');
    const transactions = [
      makeTransaction({ category: makeCategory(groceriesId, CategoryType.Expense), amount: 500, date: new Date('2026-03-10') }),
      makeTransaction({ category: makeCategory(diningId, CategoryType.Expense), amount: 800, date: new Date('2026-03-10') }),
    ];

    const result = computeSparklineData(transactions, groceriesId, 5, ref);

    const mar = result.find(p => p.month === '2026-03')!;
    expect(mar.amount).toBe(500);
  });

  it('ignores non-expense transactions', () => {
    const ref = new Date('2026-04-01');
    const groceriesExpense = makeCategory(groceriesId, CategoryType.Expense);
    const groceriesIncome = makeCategory(groceriesId, CategoryType.Income);

    const transactions = [
      makeTransaction({ category: groceriesExpense, amount: 500, date: new Date('2026-03-10') }),
      makeTransaction({ category: groceriesIncome, amount: 1000, date: new Date('2026-03-10') }),
    ];

    const result = computeSparklineData(transactions, groceriesId, 5, ref);

    const mar = result.find(p => p.month === '2026-03')!;
    // Only the expense transaction should count
    expect(mar.amount).toBe(500);
  });

  it('uses absolute values for amounts', () => {
    const ref = new Date('2026-04-01');
    const groceriesExpense = makeCategory(groceriesId, CategoryType.Expense);

    const transactions = [
      makeTransaction({ category: groceriesExpense, amount: -250, date: new Date('2026-03-10') }),
    ];

    const result = computeSparklineData(transactions, groceriesId, 5, ref);

    const mar = result.find(p => p.month === '2026-03')!;
    expect(mar.amount).toBe(250);
  });

  it('respects custom months parameter', () => {
    const ref = new Date('2026-04-01');

    const result = computeSparklineData([], groceriesId, 3, ref);

    expect(result).toHaveLength(3);
    const months = result.map(p => p.month);
    expect(months).toEqual(['2026-02', '2026-03', '2026-04']);
  });

  it('respects custom referenceDate', () => {
    const ref = new Date('2026-01-15');

    const result = computeSparklineData([], groceriesId, 5, ref);

    expect(result).toHaveLength(5);
    const months = result.map(p => p.month);
    expect(months).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01']);
  });

  it('returns all amounts zero when no matching transactions', () => {
    const ref = new Date('2026-04-01');

    const result = computeSparklineData([], groceriesId, 5, ref);

    expect(result).toHaveLength(5);
    expect(result.every(p => p.amount === 0)).toBe(true);
  });
});
