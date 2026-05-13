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

  it('getAll returns all registered categories', () => {
    const all = Category.getAll();
    expect(all.length).toBeGreaterThan(0);
    expect(all.some(c => c.id === 'groceries')).toBe(true);
  });

  it('constructor stores keywords and optional fields', () => {
    const cat = new Category('kw_test', 'KW Test', CategoryType.Expense, ['foo', 'bar'], 'icon', '#fff');
    expect(cat.keywords).toEqual(['foo', 'bar']);
    expect(cat.icon).toBe('icon');
    expect(cat.color).toBe('#fff');
  });

  describe('group property', () => {
    it('has group for expense categories', () => {
      expect(Category.fromId('groceries')?.group).toBe('needs');
      expect(Category.fromId('dining')?.group).toBe('wants');
      expect(Category.fromId('investment')?.group).toBe('saves');
    });

    it('has undefined group for income categories', () => {
      expect(Category.fromId('income')?.group).toBeUndefined();
      expect(Category.fromId('cashback')?.group).toBeUndefined();
    });

    it('has undefined group for excluded categories without group', () => {
      expect(Category.fromId('transfer')?.group).toBeUndefined();
    });
  });

  describe('getByGroup', () => {
    it('returns only needs categories', () => {
      const cats = Category.getByGroup('needs');
      expect(cats.length).toBeGreaterThan(0);
      expect(cats.every(c => c.group === 'needs')).toBe(true);
      expect(cats.map(c => c.id)).toContain('groceries');
      expect(cats.map(c => c.id)).toContain('housing');
    });

    it('returns only wants categories', () => {
      const cats = Category.getByGroup('wants');
      expect(cats.every(c => c.group === 'wants')).toBe(true);
      expect(cats.map(c => c.id)).toContain('dining');
    });

    it('returns only saves categories', () => {
      const cats = Category.getByGroup('saves');
      expect(cats.every(c => c.group === 'saves')).toBe(true);
      expect(cats.map(c => c.id)).toContain('investment');
    });
  });
});
