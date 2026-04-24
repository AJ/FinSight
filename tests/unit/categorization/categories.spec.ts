import { describe, it, expect } from 'vitest';
import { Category, CategoryType } from '@/models';
import { DEFAULT_CATEGORIES } from '@/lib/categorization/categories';

describe('DEFAULT_CATEGORIES', () => {
  it('has all expected categories', () => {
    const expectedIds = [
      'groceries', 'dining', 'transportation', 'utilities', 'housing',
      'healthcare', 'entertainment', 'shopping', 'income', 'interest',
      'cashback', 'transfer', 'bills', 'investment', 'insurance',
      'education', 'travel', 'fees', 'taxes', 'interest-expense', 'other',
    ];
    const actualIds = DEFAULT_CATEGORIES.map(c => c.id);
    for (const id of expectedIds) {
      expect(actualIds).toContain(id);
    }
    expect(DEFAULT_CATEGORIES.length).toBe(21);
  });
});

describe('Category', () => {
  it('getAll returns all registered categories', () => {
    const all = Category.getAll();
    expect(all.length).toBeGreaterThanOrEqual(21);
  });

  it('fromId finds valid category', () => {
    const cat = Category.fromId('groceries');
    expect(cat).toBeDefined();
    expect(cat!.name).toBe('Groceries');
  });

  it('fromId returns undefined for invalid ID', () => {
    expect(Category.fromId('nonexistent')).toBeUndefined();
  });

  it('getByType returns expense categories', () => {
    const expenses = Category.getByType(CategoryType.Expense);
    expect(expenses.length).toBeGreaterThan(0);
    expect(expenses.every(c => c.isExpense)).toBe(true);
  });

  it('getByType returns income categories', () => {
    const income = Category.getByType(CategoryType.Income);
    expect(income.length).toBeGreaterThan(0);
    expect(income.every(c => c.isIncome)).toBe(true);
  });

  it('category IDs are unique', () => {
    const all = Category.getAll();
    const ids = all.map(c => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
