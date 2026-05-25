import { describe, it, expect } from 'vitest';
import '@/lib/categorization/categories';
import { getBudgetableCategories, getBudgetableCategoryIds, isBudgetable, getCategoryGroup, groupStyles, partitionCategories } from '@/lib/budget/categoryEligibility';

describe('categoryEligibility', () => {
  it('returns all expense categories plus investment and other', () => {
    const cats = getBudgetableCategories();
    const ids = cats.map(c => c.id);

    // Expense categories
    expect(ids).toContain('groceries');
    expect(ids).toContain('dining');
    expect(ids).toContain('transportation');
    expect(ids).toContain('utilities');
    expect(ids).toContain('housing');
    expect(ids).toContain('healthcare');
    expect(ids).toContain('entertainment');
    expect(ids).toContain('shopping');
    expect(ids).toContain('bills');
    expect(ids).toContain('insurance');
    expect(ids).toContain('education');
    expect(ids).toContain('travel');
    expect(ids).toContain('fees');
    expect(ids).toContain('taxes');
    expect(ids).toContain('interest-expense');

    // Special inclusions
    expect(ids).toContain('investment');
    expect(ids).toContain('other');

    // Total count
    expect(ids).toHaveLength(17);
  });

  it('excludes income categories', () => {
    const ids = getBudgetableCategories().map(c => c.id);
    expect(ids).not.toContain('income');
    expect(ids).not.toContain('cashback');
  });

  it('excludes transfer category', () => {
    const ids = getBudgetableCategories().map(c => c.id);
    expect(ids).not.toContain('transfer');
  });

  it('isBudgetable returns true for budgetable categories', () => {
    expect(isBudgetable('groceries')).toBe(true);
    expect(isBudgetable('investment')).toBe(true);
    expect(isBudgetable('other')).toBe(true);
  });

  it('isBudgetable returns false for non-budgetable categories', () => {
    expect(isBudgetable('income')).toBe(false);
    expect(isBudgetable('transfer')).toBe(false);
    expect(isBudgetable('cashback')).toBe(false);
  });

  it('getBudgetableCategoryIds returns string IDs', () => {
    const ids = getBudgetableCategoryIds();
    expect(ids).toContain('groceries');
    expect(ids).toHaveLength(17);
  });
});

describe('getCategoryGroup', () => {
  it('classifies needs categories', () => {
    expect(getCategoryGroup('groceries')).toBe('Needs');
    expect(getCategoryGroup('housing')).toBe('Needs');
    expect(getCategoryGroup('transportation')).toBe('Needs');
  });

  it('classifies wants categories', () => {
    expect(getCategoryGroup('dining')).toBe('Wants');
    expect(getCategoryGroup('entertainment')).toBe('Wants');
    expect(getCategoryGroup('shopping')).toBe('Wants');
  });

  it('classifies saves categories', () => {
    expect(getCategoryGroup('investment')).toBe('Saves');
    expect(getCategoryGroup('other')).toBe('Saves');
  });

  it('returns null for ungrouped categories', () => {
    expect(getCategoryGroup('income')).toBeNull();
    expect(getCategoryGroup('cashback')).toBeNull();
  });

  it('returns null for nonexistent category id', () => {
    expect(getCategoryGroup('totally-fake-category')).toBeNull();
  });
});

describe('groupStyles', () => {
  it('has a style entry for each group', () => {
    expect(groupStyles.Needs).toBeTruthy();
    expect(groupStyles.Wants).toBeTruthy();
    expect(groupStyles.Saves).toBeTruthy();
  });
});

describe('partitionCategories', () => {
  const allIds = ['groceries', 'dining', 'housing', 'travel'];

  it('partitions into visible (not hidden, has allocation) and hidden', () => {
    const { visible, hidden } = partitionCategories(
      allIds,
      ['travel'],
      { groceries: 5000, dining: 3000 },
    );

    expect(visible).toEqual(['groceries', 'dining']);
    expect(hidden).toEqual(['housing', 'travel']);
  });

  it('returns all hidden when no allocations', () => {
    const { visible, hidden } = partitionCategories(allIds, [], {});

    expect(visible).toEqual([]);
    expect(hidden).toEqual(allIds);
  });

  it('returns all visible when all have allocations and none hidden', () => {
    const allocations = { groceries: 1000, dining: 2000, housing: 3000, travel: 500 };
    const { visible, hidden } = partitionCategories(allIds, [], allocations);

    expect(visible).toEqual(allIds);
    expect(hidden).toEqual([]);
  });

  it('handles empty category list', () => {
    const { visible, hidden } = partitionCategories([], [], {});

    expect(visible).toEqual([]);
    expect(hidden).toEqual([]);
  });
});
