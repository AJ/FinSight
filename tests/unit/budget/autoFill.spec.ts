import { describe, it, expect } from 'vitest';
import { computeAutoFill } from '@/lib/budget/autoFill';
import { makeTransaction, makeCategory } from '@tests/unit/factories';
import { Category } from '@/models';
import '@/lib/categorization/categories';

const groceries = Category.fromId('groceries')!;
const dining = Category.fromId('dining')!;
const transportation = Category.fromId('transportation')!;
const entertainment = Category.fromId('entertainment')!;
const housing = Category.fromId('housing')!;

/**
 * Helper: create expense transactions spread across months so the
 * median-monthly-forecast produces a predictable value.
 *
 * With 3 months (Jan–Mar 2026), putting the same amount in each month
 * yields a median equal to that amount.
 */
function spreadAcrossMonths(
  categoryId: string,
  monthlyAmount: number,
  months: [number, number][] = [[0, 15], [1, 10], [2, 5]],
): ReturnType<typeof makeTransaction>[] {
  const cat = Category.fromId(categoryId) ?? makeCategory(categoryId);
  return months.map(([monthOffset, day]) =>
    makeTransaction({
      date: new Date(2026, monthOffset, day),
      amount: monthlyAmount,
      category: cat,
    }),
  );
}

describe('computeAutoFill', () => {
  it('returns null when all forecasts are zero (empty transactions)', () => {
    const result = computeAutoFill({
      localIncome: 50000,
      medianIncome: 40000,
      transactions: [],
    });

    expect(result).toBeNull();
  });

  it('returns null when both localIncome and medianIncome are zero', () => {
    const transactions = spreadAcrossMonths('groceries', 3000);

    const result = computeAutoFill({
      localIncome: 0,
      medianIncome: 0,
      transactions,
    });

    expect(result).toBeNull();
  });

  it('uses localIncome when set, ignoring medianIncome', () => {
    const transactions = spreadAcrossMonths('groceries', 3000);

    const result = computeAutoFill({
      localIncome: 50000,
      medianIncome: 99999,
      transactions,
    });

    expect(result).not.toBeNull();
    expect(result!.income).toBe(50000);
  });

  it('falls back to medianIncome when localIncome is zero', () => {
    const transactions = spreadAcrossMonths('groceries', 3000);

    const result = computeAutoFill({
      localIncome: 0,
      medianIncome: 40000,
      transactions,
    });

    expect(result).not.toBeNull();
    expect(result!.income).toBe(40000);
  });

  it('selects categories covering top 90% cumulative spend', () => {
    // Create categories with very different spend levels:
    //   groceries: 5000/month  (median of 5000, 5000, 5000)
    //   dining:    2000/month  (median of 2000, 2000, 2000)
    //   entertainment: 200/month (median of 200, 200, 200)
    // Total forecast = 7200, 90% threshold = 6480
    // Sorted: groceries(5000), dining(2000), entertainment(200)
    // Cumulative after groceries: 5000 (< 6480), include dining
    // Cumulative after dining: 7000 (>= 6480), stop
    // So selected = [groceries, dining], entertainment is hidden
    const transactions = [
      ...spreadAcrossMonths('groceries', 5000),
      ...spreadAcrossMonths('dining', 2000),
      ...spreadAcrossMonths('entertainment', 200),
    ];

    const result = computeAutoFill({
      localIncome: 15000,
      medianIncome: 0,
      transactions,
    });

    expect(result).not.toBeNull();
    expect(result!.allocations).toHaveProperty('groceries');
    expect(result!.allocations).toHaveProperty('dining');
    expect(result!.allocations).not.toHaveProperty('entertainment');
    expect(result!.hidden).toContain('entertainment');
  });

  it('distributes budget proportionally to forecast amounts', () => {
    // groceries: 3000/month, dining: 1000/month
    // Selected total forecast = 4000
    // groceries share = 3000/4000 = 75%, dining share = 1000/4000 = 25%
    // Budget = 10000 (roundTo = 100)
    // groceries allocation = 10000 * 3000/4000 = 7500, rounded to nearest 100 = 7500
    // dining allocation = 10000 * 1000/4000 = 2500, rounded to nearest 100 = 2500
    const transactions = [
      ...spreadAcrossMonths('groceries', 3000),
      ...spreadAcrossMonths('dining', 1000),
    ];

    const result = computeAutoFill({
      localIncome: 10000,
      medianIncome: 0,
      transactions,
    });

    expect(result).not.toBeNull();
    expect(result!.allocations['groceries']).toBe(7500);
    expect(result!.allocations['dining']).toBe(2500);
  });

  it('rounds to nearest 100 when budget < 20000', () => {
    // groceries: 3300/month, dining: 1100/month
    // Selected total forecast = 4400
    // Budget = 8000 (roundTo = 100)
    // groceries = 8000 * 3300/4400 = 6000 → 6000 (already multiple of 100)
    // dining = 8000 * 1100/4400 = 2000 → 2000
    // But let's use amounts that produce non-round values:
    // groceries: 3100, dining: 1300, total = 4400
    // groceries = 8000 * 3100/4400 = 5636.36... → round(5636.36/100)*100 = round(56.36)*100 = 5600
    // dining = 8000 * 1300/4400 = 2363.63... → round(2363.63/100)*100 = round(23.64)*100 = 2400
    const transactions = [
      ...spreadAcrossMonths('groceries', 3100),
      ...spreadAcrossMonths('dining', 1300),
    ];

    const result = computeAutoFill({
      localIncome: 8000,
      medianIncome: 0,
      transactions,
    });

    expect(result).not.toBeNull();
    // Verify rounding to nearest 100
    expect(result!.allocations['groceries']! % 100).toBe(0);
    expect(result!.allocations['dining']! % 100).toBe(0);
  });

  it('rounds to nearest 1000 when budget >= 20000', () => {
    // groceries: 5000/month, dining: 2000/month, transportation: 1000/month
    // Total forecast = 8000, threshold = 7200
    // Sorted: groceries(5000) → cum=5000 < 7200, dining(2000) → cum=7000 < 7200,
    // transportation(1000) → cum=8000 >= 7200
    // All three selected. Selected total = 8000.
    // Budget = 30000 (roundTo = 1000)
    // groceries = 30000 * 5000/8000 = 18750 → round(18750/1000)*1000 = 19000
    // dining = 30000 * 2000/8000 = 7500 → round(7500/1000)*1000 = 8000
    // transportation = 30000 * 1000/8000 = 3750 → round(3750/1000)*1000 = 4000
    const transactions = [
      ...spreadAcrossMonths('groceries', 5000),
      ...spreadAcrossMonths('dining', 2000),
      ...spreadAcrossMonths('transportation', 1000),
    ];

    const result = computeAutoFill({
      localIncome: 30000,
      medianIncome: 0,
      transactions,
    });

    expect(result).not.toBeNull();
    expect(result!.allocations['groceries']! % 1000).toBe(0);
    expect(result!.allocations['dining']! % 1000).toBe(0);
    expect(result!.allocations['transportation']! % 1000).toBe(0);
    expect(result!.allocations['groceries']).toBe(19000);
    expect(result!.allocations['dining']).toBe(8000);
    expect(result!.allocations['transportation']).toBe(4000);
  });

  it('hides unselected categories', () => {
    // Only groceries has spending. All other budgetable categories should be hidden.
    const transactions = spreadAcrossMonths('groceries', 3000);

    const result = computeAutoFill({
      localIncome: 10000,
      medianIncome: 0,
      transactions,
    });

    expect(result).not.toBeNull();
    // groceries is the only category with forecast > 0, so only it is selected
    expect(result!.allocations).toHaveProperty('groceries');
    // Every other budgetable category should be in hidden
    expect(result!.hidden).not.toContain('groceries');
    // Spot-check a few known budgetable expense categories
    expect(result!.hidden).toContain('dining');
    expect(result!.hidden).toContain('transportation');
    expect(result!.hidden).toContain('entertainment');
  });

  it('handles single category with all spending', () => {
    // Only groceries has transactions. It covers 100% of spend, which is >= 90%.
    const transactions = spreadAcrossMonths('groceries', 4000);

    const result = computeAutoFill({
      localIncome: 10000,
      medianIncome: 0,
      transactions,
    });

    expect(result).not.toBeNull();
    // Single category gets the entire budget, rounded to nearest 100
    expect(result!.allocations['groceries']).toBe(10000);
    // Only one allocation key
    expect(Object.keys(result!.allocations)).toHaveLength(1);
    // All other categories hidden
    expect(result!.hidden.length).toBeGreaterThan(0);
    expect(result!.hidden).not.toContain('groceries');
  });
});
