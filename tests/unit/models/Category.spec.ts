import { describe, it, expect } from 'vitest';
import { Category, CategoryType } from '@/models';
import '@/lib/categorization/categories';

describe('Category', () => {
  it('registers category', () => {
    const cat = new Category('test', 'Test', CategoryType.Expense);
    Category.register(cat);
    expect(Category.fromId('test')).toBeDefined();
  });

  it('finds by ID', () => {
    const cat = Category.fromId('groceries');
    expect(cat).toBeDefined();
    expect(cat!.name).toBe('Groceries');
  });

  it('returns undefined for unknown ID', () => {
    expect(Category.fromId('fake')).toBeUndefined();
  });

  it('DEFAULT_ID is other', () => {
    expect(Category.DEFAULT_ID).toBe('other');
  });

  it('filters by type — expenses', () => {
    const expenses = Category.getByType(CategoryType.Expense);
    expect(expenses.length).toBeGreaterThan(0);
    expect(expenses.every(c => c.isExpense)).toBe(true);
  });

  it('filters by type — income', () => {
    const income = Category.getByType(CategoryType.Income);
    expect(income.length).toBeGreaterThan(0);
    expect(income.every(c => c.isIncome)).toBe(true);
  });

  it('getters work', () => {
    const cat = new Category('test2', 'Test', CategoryType.Income);
    expect(cat.isIncome).toBe(true);
    expect(cat.isExpense).toBe(false);
    expect(cat.isExcluded).toBe(false);
  });
});
