import { describe, it, expect } from 'vitest';
import { buildHighlights } from '@/lib/budget/highlights';
import { makeBudgetProgress } from '@tests/unit/factories';
import '@/lib/categorization/categories';

const INR = { code: 'INR', symbol: '₹', name: 'Indian Rupee' };

describe('buildHighlights', () => {
  it('returns empty array when all budgets are zero', () => {
    const progress = [
      makeBudgetProgress({ categoryId: 'groceries', budgeted: 0, spent: 0, status: 'not-set' }),
      makeBudgetProgress({ categoryId: 'dining', budgeted: 0, spent: 0, status: 'not-set' }),
    ];

    const result = buildHighlights(progress, INR);

    expect(result).toEqual([]);
  });

  it('classifies over-budget category', () => {
    const progress = [
      makeBudgetProgress({
        categoryId: 'groceries',
        budgeted: 5000,
        spent: 6000,
        remaining: -1000,
        percentUsed: 120,
        status: 'over-budget',
      }),
    ];

    const result = buildHighlights(progress, INR);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('over-budget');
    expect(result[0].categoryId).toBe('groceries');
    expect(result[0].text).toContain('exceeded budget by');
    expect(result[0].dotColor).toBe('bg-red-500');
  });

  it('classifies warning category', () => {
    const progress = [
      makeBudgetProgress({
        categoryId: 'groceries',
        budgeted: 5000,
        spent: 4200,
        remaining: 800,
        percentUsed: 84,
        status: 'warning',
      }),
    ];

    const result = buildHighlights(progress, INR);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('warning');
    expect(result[0].text).toContain('at 84%');
    expect(result[0].dotColor).toBe('bg-yellow-500');
  });

  it('classifies on-track category', () => {
    const progress = [
      makeBudgetProgress({
        categoryId: 'groceries',
        budgeted: 5000,
        spent: 2000,
        remaining: 3000,
        percentUsed: 40,
        status: 'on-track',
      }),
    ];

    const result = buildHighlights(progress, INR);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('on-track');
    expect(result[0].text).toContain('on track at 40%');
    expect(result[0].dotColor).toBe('bg-green-500');
  });

  it('sorts: over-budget first, then warning, then on-track', () => {
    const progress = [
      makeBudgetProgress({
        categoryId: 'entertainment',
        budgeted: 3000,
        spent: 1500,
        percentUsed: 50,
        status: 'on-track',
      }),
      makeBudgetProgress({
        categoryId: 'groceries',
        budgeted: 5000,
        spent: 6000,
        percentUsed: 120,
        status: 'over-budget',
      }),
      makeBudgetProgress({
        categoryId: 'dining',
        budgeted: 4000,
        spent: 3500,
        percentUsed: 88,
        status: 'warning',
      }),
    ];

    const result = buildHighlights(progress, INR);

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('over-budget');
    expect(result[0].categoryId).toBe('groceries');
    expect(result[1].type).toBe('warning');
    expect(result[1].categoryId).toBe('dining');
    expect(result[2].type).toBe('on-track');
    expect(result[2].categoryId).toBe('entertainment');
  });

  it('limits to 3 highlights', () => {
    const progress = [
      makeBudgetProgress({ categoryId: 'groceries', budgeted: 5000, spent: 6000, status: 'over-budget' }),
      makeBudgetProgress({ categoryId: 'dining', budgeted: 3000, spent: 4000, status: 'over-budget' }),
      makeBudgetProgress({ categoryId: 'entertainment', budgeted: 2000, spent: 1800, percentUsed: 90, status: 'warning' }),
      makeBudgetProgress({ categoryId: 'transportation', budgeted: 2000, spent: 1700, percentUsed: 85, status: 'warning' }),
      makeBudgetProgress({ categoryId: 'utilities', budgeted: 1500, spent: 500, percentUsed: 33, status: 'on-track' }),
      makeBudgetProgress({ categoryId: 'healthcare', budgeted: 1000, spent: 200, percentUsed: 20, status: 'on-track' }),
    ];

    const result = buildHighlights(progress, INR);

    expect(result).toHaveLength(3);
  });

  it('sorts on-track items by highest budgeted amount', () => {
    const progress = [
      makeBudgetProgress({
        categoryId: 'entertainment',
        budgeted: 3000,
        spent: 1000,
        percentUsed: 33,
        status: 'on-track',
      }),
      makeBudgetProgress({
        categoryId: 'groceries',
        budgeted: 10000,
        spent: 4000,
        percentUsed: 40,
        status: 'on-track',
      }),
    ];

    const result = buildHighlights(progress, INR);

    expect(result).toHaveLength(2);
    expect(result[0].categoryId).toBe('groceries');
    expect(result[0].type).toBe('on-track');
    expect(result[1].categoryId).toBe('entertainment');
    expect(result[1].type).toBe('on-track');
  });

  it('skips categories with budgeted <= 0', () => {
    const progress = [
      makeBudgetProgress({
        categoryId: 'groceries',
        budgeted: 0,
        spent: 500,
        remaining: -500,
        percentUsed: 0,
        status: 'not-set',
      }),
      makeBudgetProgress({
        categoryId: 'dining',
        budgeted: 5000,
        spent: 2000,
        percentUsed: 40,
        status: 'on-track',
      }),
    ];

    const result = buildHighlights(progress, INR);

    expect(result).toHaveLength(1);
    expect(result[0].categoryId).toBe('dining');
  });

  it('formats currency correctly', () => {
    const progress = [
      makeBudgetProgress({
        categoryId: 'groceries',
        budgeted: 5000,
        spent: 7000,
        remaining: -2000,
        percentUsed: 140,
        status: 'over-budget',
      }),
    ];

    const result = buildHighlights(progress, INR);

    expect(result).toHaveLength(1);
    // The exceeded amount is 7000 - 5000 = 2000
    expect(result[0].text).toContain('₹');
    expect(result[0].text).toContain('2,000');
  });
});
