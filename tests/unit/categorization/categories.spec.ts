import { describe, it, expect } from 'vitest';
import { Category } from '@/models';
import { DEFAULT_CATEGORIES, getCategoryById, getCategoryIds } from '@/lib/categorization/categories';

describe('DEFAULT_CATEGORIES', () => {
  it('has all expected categories', () => {
    const expectedIds = [
      'groceries', 'dining', 'transportation', 'utilities', 'housing',
      'healthcare', 'entertainment', 'shopping', 'income', 'interest',
      'cashback', 'transfer', 'bills', 'cc_bill_payment', 'loans',
      'investment', 'insurance', 'education', 'travel', 'fees', 'taxes',
      'cash_withdrawal', 'adjustment', 'other',
    ];
    const actualIds = DEFAULT_CATEGORIES.map(c => c.id);
    for (const id of expectedIds) {
      expect(actualIds).toContain(id);
    }
    expect(DEFAULT_CATEGORIES.length).toBe(24);
  });

  it('collapses interest-expense into a single interest category', () => {
    expect(Category.fromId('interest-expense')).toBeUndefined();
    expect(Category.fromId('interest')).toBeDefined();
  });

  it('registers cash_withdrawal and adjustment', () => {
    expect(Category.fromId('cash_withdrawal')).toBeDefined();
    expect(Category.fromId('adjustment')).toBeDefined();
  });
});

describe('Category', () => {
  it('getAll returns all registered categories', () => {
    const all = Category.getAll();
    expect(all.length).toBeGreaterThanOrEqual(24);
  });

  it('fromId finds valid category', () => {
    const cat = Category.fromId('groceries');
    expect(cat).toBeDefined();
    expect(cat!.name).toBe('Groceries');
  });

  it('fromId returns undefined for invalid ID', () => {
    expect(Category.fromId('nonexistent')).toBeUndefined();
  });

  it('category IDs are unique', () => {
    const all = Category.getAll();
    const ids = all.map(c => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

describe('budgetable flag (spec §5.1)', () => {
  const budgetable = ['groceries', 'dining', 'transportation', 'utilities', 'housing',
    'healthcare', 'entertainment', 'shopping', 'bills', 'investment', 'insurance',
    'education', 'travel', 'other'];
  const notBudgetable = ['income', 'interest', 'cashback', 'transfer', 'cc_bill_payment',
    'loans', 'fees', 'taxes', 'cash_withdrawal', 'adjustment'];

  it('planned spending + investment + other are budgetable', () => {
    for (const id of budgetable) expect(Category.fromId(id)?.budgetable, id).toBe(true);
  });

  it('income, interest, transfers, debt, fees, taxes, withdrawal, adjustment are not budgetable', () => {
    for (const id of notBudgetable) expect(Category.fromId(id)?.budgetable, id).toBe(false);
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
    expect(ids.length).toBe(24);
    expect(ids).toContain('groceries');
    expect(ids).toContain('other');
    expect(ids).toContain('cc_bill_payment');
    expect(ids).toContain('loans');
    expect(ids).toContain('cash_withdrawal');
    expect(ids).toContain('adjustment');
  });
});

describe('Accounting-redesign category keywords', () => {
  it('registers cc_bill_payment with CC-payment keywords (not budgetable)', () => {
    const cat = getCategoryById('cc_bill_payment');
    expect(cat).toBeDefined();
    expect(cat!.budgetable).toBe(false);
    expect(cat!.keywords).toEqual(
      expect.arrayContaining(['cc payment', 'credit card payment', 'credit card bill'])
    );
  });

  it('registers loans with loan/EMI keywords (not budgetable)', () => {
    const cat = getCategoryById('loans');
    expect(cat).toBeDefined();
    expect(cat!.budgetable).toBe(false);
    expect(cat!.keywords).toEqual(
      expect.arrayContaining(['loan emi', 'loan repayment', 'emi'])
    );
  });

  it('registers investment as budgetable', () => {
    const cat = getCategoryById('investment');
    expect(cat).toBeDefined();
    expect(cat!.budgetable).toBe(true);
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
});
