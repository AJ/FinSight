import { describe, it, expect } from 'vitest';
import { migrateTransactionCategories, restoreCorruptedCategory } from '@/lib/analytics/migration';
import { makeTransaction, makeCategory } from '@tests/unit/factories';

describe('migrateTransactionCategories', () => {
  // --- CC bill payment migration ---

  it('moves CC payment keywords from bills to cc_bill_payment with debt subType', () => {
    const txn = makeTransaction({
      amount: 30000, transactionSubType: 'bill_payment',
      category: makeCategory('bills', true),
      description: 'NEFT-HDFC CC Payment',
    });
    const result = migrateTransactionCategories(txn);
    expect(result.categoryId).toBe('cc_bill_payment');
    expect(result.transactionSubType).toBe('debt_payment');
    expect(result.changed).toBe(true);
  });

  it('detects CC payment regardless of current category', () => {
    const txn = makeTransaction({
      amount: 30000, transactionSubType: 'purchase',
      category: makeCategory('shopping', true),
      description: 'Credit Card Payment - HDFC',
    });
    const result = migrateTransactionCategories(txn);
    expect(result.categoryId).toBe('cc_bill_payment');
    expect(result.transactionSubType).toBe('debt_payment');
    expect(result.changed).toBe(true);
  });

  // --- Loan/EMI migration ---

  it('moves loan/EMI keywords from bills to loans with debt subType', () => {
    const txn = makeTransaction({
      amount: 15000, transactionSubType: 'bill_payment',
      category: makeCategory('bills', true),
      description: 'EMI - Personal Loan - HDFC',
    });
    const result = migrateTransactionCategories(txn);
    expect(result.categoryId).toBe('loans');
    expect(result.transactionSubType).toBe('debt_payment');
    expect(result.changed).toBe(true);
  });

  // --- Investment subType migration ---

  it('sets investment subType for investment category transactions', () => {
    const txn = makeTransaction({
      amount: 10000, transactionSubType: 'purchase',
      category: makeCategory('investment', true),
      description: 'SIP - HDFC Mutual Fund',
    });
    const result = migrateTransactionCategories(txn);
    expect(result.categoryId).toBe('investment');
    expect(result.transactionSubType).toBe('investment');
    expect(result.changed).toBe(true);
  });

  // --- Unaffected transactions ---

  it('returns unchanged for unaffected transactions', () => {
    const txn = makeTransaction({
      amount: 2000, transactionSubType: 'purchase',
      category: makeCategory('groceries', true),
      description: 'BigBasket Order',
    });
    const result = migrateTransactionCategories(txn);
    expect(result.changed).toBe(false);
    expect(result.categoryId).toBe('groceries');
  });

  it('returns unchanged for already-migrated CC bill payment', () => {
    const txn = makeTransaction({
      amount: 30000, transactionSubType: 'debt_payment',
      category: makeCategory('cc_bill_payment', false),
      description: 'CC Payment HDFC',
    });
    const result = migrateTransactionCategories(txn);
    expect(result.changed).toBe(false);
  });

  it('returns unchanged for already-migrated loan', () => {
    const txn = makeTransaction({
      amount: 15000, transactionSubType: 'debt_payment',
      category: makeCategory('loans', false),
      description: 'Home Loan EMI',
    });
    const result = migrateTransactionCategories(txn);
    expect(result.changed).toBe(false);
  });

  // --- Adversary / edge cases ---

  it('does not migrate "emi" substring in unrelated words (e.g. "seminar")', () => {
    const txn = makeTransaction({
      amount: 5000, transactionSubType: 'purchase',
      category: makeCategory('bills', true),
      description: 'Seminar Registration Fee',
    });
    const result = migrateTransactionCategories(txn);
    expect(result.changed).toBe(false);
  });

  it('does not migrate investment with investment subType already set', () => {
    const txn = makeTransaction({
      amount: 5000, transactionSubType: 'investment',
      category: makeCategory('investment', true),
      description: 'MF Dividend Credit',
    });
    const result = migrateTransactionCategories(txn);
    expect(result.changed).toBe(false);
  });

  it('handles plain object without category gracefully', () => {
    const result = migrateTransactionCategories({ description: 'Random Transfer' });
    expect(result.changed).toBe(false);
  });

  it('handles empty description', () => {
    const result = migrateTransactionCategories({ description: '' });
    expect(result.changed).toBe(false);
  });

  // --- String category handling (persist migration fix) ---

  it('handles string category (persist format) for subType migration', () => {
    const result = migrateTransactionCategories({
      category: 'salary',
      transactionSubType: 'deposit',
      description: 'NEFT-Salary',
    });
    expect(result.changed).toBe(true);
    expect(result.categoryId).toBe('salary'); // preserved, not wiped
    expect(result.transactionSubType).toBe('transfer');
  });

  it('preserves string category when no migration needed', () => {
    const result = migrateTransactionCategories({
      category: 'groceries',
      transactionSubType: 'purchase',
      description: 'BigBasket',
    });
    expect(result.changed).toBe(false);
    expect(result.categoryId).toBe('groceries');
  });

  it('handles string category for bill_payment subType', () => {
    const result = migrateTransactionCategories({
      category: 'cc_bill_payment',
      transactionSubType: 'bill_payment',
      description: 'CC Payment',
    });
    expect(result.changed).toBe(true);
    expect(result.categoryId).toBe('cc_bill_payment');
    expect(result.transactionSubType).toBe('debt_payment');
  });
});

describe('restoreCorruptedCategory', () => {
  it('skips transactions with valid category', () => {
    expect(restoreCorruptedCategory({ category: 'salary' })).toBe('salary');
  });

  it('restores CC payment from description', () => {
    expect(restoreCorruptedCategory({
      category: '',
      description: 'NEFT-HDFC CC Payment',
    })).toBe('cc_bill_payment');
  });

  it('restores loan from description', () => {
    expect(restoreCorruptedCategory({
      category: '',
      description: 'EMI - Personal Loan',
    })).toBe('loans');
  });

  it('restores investment from subType', () => {
    expect(restoreCorruptedCategory({
      category: '',
      transactionSubType: 'investment',
    })).toBe('investment');
  });

  it('restores salary from description pattern', () => {
    expect(restoreCorruptedCategory({
      category: '',
      description: 'Salary - May 2026',
    })).toBe('income');
  });

  it('restores bank credit as salary (best guess)', () => {
    expect(restoreCorruptedCategory({
      category: '',
      sourceType: 'bank',
      type: 'credit',
      description: 'NEFT Transfer',
    })).toBe('salary');
  });

  it('restores bank debit debt_payment as cc_bill_payment', () => {
    expect(restoreCorruptedCategory({
      category: '',
      sourceType: 'bank',
      type: 'debit',
      transactionSubType: 'debt_payment',
    })).toBe('cc_bill_payment');
  });

  it('returns other when no inference possible', () => {
    expect(restoreCorruptedCategory({
      category: '',
      sourceType: 'credit_card',
      type: 'debit',
    })).toBe('other');
  });
});
