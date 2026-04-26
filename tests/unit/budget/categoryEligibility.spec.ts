import { describe, it, expect } from 'vitest';
import '@/lib/categorization/categories';
import { getBudgetableCategories, getBudgetableCategoryIds, isBudgetable } from '@/lib/budget/categoryEligibility';

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
