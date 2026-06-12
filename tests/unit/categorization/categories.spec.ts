import { describe, it, expect } from 'vitest';
import { Category, CategoryType } from '@/models';
import { DEFAULT_CATEGORIES, getCategoryById, getCategoryIds, getCategoriesByType } from '@/lib/categorization/categories';

describe('DEFAULT_CATEGORIES', () => {
  it('has all expected categories', () => {
    const expectedIds = [
      'groceries', 'dining', 'transportation', 'utilities', 'housing',
      'healthcare', 'entertainment', 'shopping', 'income', 'interest',
      'cashback', 'transfer', 'bills', 'cc_bill_payment', 'loans',
      'investment', 'insurance', 'education', 'travel', 'fees', 'taxes',
      'interest-expense', 'other',
    ];
    const actualIds = DEFAULT_CATEGORIES.map(c => c.id);
    for (const id of expectedIds) {
      expect(actualIds).toContain(id);
    }
    expect(DEFAULT_CATEGORIES.length).toBe(23);
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

describe('getCategoryById', () => {
  it('returns category for valid ID', () => {
    const cat = getCategoryById('groceries');
    expect(cat).toBeDefined();
    expect(cat!.name).toBe('Groceries');
  });

  it('returns undefined for unknown ID', () => {
    expect(getCategoryById('nonexistent')).toBeUndefined();
  });
});

describe('getCategoryIds', () => {
  it('returns all category IDs as strings', () => {
    const ids = getCategoryIds();
    expect(ids.length).toBe(23);
    expect(ids).toContain('groceries');
    expect(ids).toContain('other');
    expect(ids).toContain('cc_bill_payment');
    expect(ids).toContain('loans');
  });
});

describe('getCategoriesByType', () => {
  it('returns only expense categories', () => {
    const cats = getCategoriesByType(CategoryType.Expense);
    expect(cats.length).toBeGreaterThan(0);
    expect(cats.every(c => c.isExpense)).toBe(true);
  });

  it('returns only income categories', () => {
    const cats = getCategoriesByType(CategoryType.Income);
    expect(cats.length).toBeGreaterThan(0);
    expect(cats.every(c => c.isIncome)).toBe(true);
  });

  it('returns only excluded categories', () => {
    const cats = getCategoriesByType(CategoryType.Excluded);
    const excludedIds = cats.map(c => c.id);
    expect(excludedIds.sort()).toEqual(['transfer']);
    expect(cats.every(c => c.isExcluded)).toBe(true);
  });

  it('returns only debt payment categories', () => {
    const cats = getCategoriesByType(CategoryType.DebtPayment);
    const ids = cats.map(c => c.id);
    expect(ids.sort()).toEqual(['cc_bill_payment', 'loans']);
    expect(cats.every(c => c.isDebtPayment)).toBe(true);
  });

  it('returns only investment categories', () => {
    const cats = getCategoriesByType(CategoryType.Investment);
    const ids = cats.map(c => c.id);
    expect(ids).toEqual(['investment']);
    expect(cats.every(c => c.isInvestment)).toBe(true);
  });
});

describe('New categories for accounting redesign', () => {
  it('registers cc_bill_payment as DebtPayment category', () => {
    const cat = getCategoryById('cc_bill_payment');
    expect(cat).toBeDefined();
    expect(cat!.type).toBe(CategoryType.DebtPayment);
    expect(cat!.keywords).toEqual(
      expect.arrayContaining(['cc payment', 'credit card payment', 'credit card bill'])
    );
  });

  it('registers loans as DebtPayment category', () => {
    const cat = getCategoryById('loans');
    expect(cat).toBeDefined();
    expect(cat!.type).toBe(CategoryType.DebtPayment);
    expect(cat!.keywords).toEqual(
      expect.arrayContaining(['loan emi', 'loan repayment', 'emi'])
    );
  });

  it('registers investment as Investment category', () => {
    const cat = getCategoryById('investment');
    expect(cat).toBeDefined();
    expect(cat!.type).toBe(CategoryType.Investment);
  });

  it('bills category no longer contains CC payment or loan/EMI keywords', () => {
    const cat = getCategoryById('bills');
    expect(cat).toBeDefined();
    const removedKeywords = ['cc payment', 'credit card payment', 'card payment',
      'credit card bill', 'card bill', 'loan payment', 'emi', 'loan emi', 'loan repayment'];
    for (const kw of removedKeywords) {
      expect(cat!.keywords).not.toContain(kw);
    }
  });

  it('bills category retains non-CC payment keywords', () => {
    const cat = getCategoryById('bills');
    expect(cat!.keywords).toEqual(
      expect.arrayContaining(['bill payment', 'bill pay', 'autopay'])
    );
  });

  it('cc_bill_payment and loans are distinct categories with different keywords', () => {
    const cc = getCategoryById('cc_bill_payment')!;
    const loans = getCategoryById('loans')!;
    expect(cc.keywords).not.toContain('loan emi');
    expect(cc.keywords).not.toContain('home loan');
    expect(loans.keywords).not.toContain('cc payment');
    expect(loans.keywords).not.toContain('hdfc billpay');
  });

  it('cc_bill_payment and loans both report isDebtPayment as true', () => {
    expect(getCategoryById('cc_bill_payment')!.isDebtPayment).toBe(true);
    expect(getCategoryById('loans')!.isDebtPayment).toBe(true);
    expect(getCategoryById('cc_bill_payment')!.isExcluded).toBe(false);
    expect(getCategoryById('loans')!.isExcluded).toBe(false);
    expect(getCategoryById('cc_bill_payment')!.isExpense).toBe(false);
    expect(getCategoryById('loans')!.isExpense).toBe(false);
  });
});
