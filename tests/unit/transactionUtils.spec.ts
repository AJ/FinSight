import { describe, it, expect } from 'vitest';

import { getTransactionSignature, deduplicateTransactions, getCategoryType, isIncome, isExpense, isExcluded } from '@/lib/transactionUtils';
import { makeTransaction, makeCategory } from '@tests/unit/factories';
import { CategoryType } from '@/types';
import '@/lib/categorization/categories';

describe('getTransactionSignature', () => {
  it('includes date, absolute amount, and lowercase description', () => {
    const sig = getTransactionSignature({
      date: '2024-01-15',
      amount: -99.99,
      description: 'Amazon Purchase',
    });
    expect(sig).toBe('2024-01-15|99.99|amazon purchase');
  });

  it('uses absolute value of amount', () => {
    const credit = getTransactionSignature({ date: '2024-01-15', amount: 5000, description: 'Salary' });
    const debit = getTransactionSignature({ date: '2024-01-15', amount: -5000, description: 'Salary' });
    expect(credit).toBe(debit);
  });

  it('truncates description to 100 characters', () => {
    const longDesc = 'A'.repeat(200);
    const sig = getTransactionSignature({ date: '2024-01-15', amount: 100, description: longDesc });
    const descPart = sig.split('|')[2];
    expect(descPart.length).toBe(100);
  });

  it('produces same signature for identical transactions', () => {
    const sig1 = getTransactionSignature({ date: '2024-01-15', amount: 100, description: 'Test' });
    const sig2 = getTransactionSignature({ date: '2024-01-15', amount: 100, description: 'Test' });
    expect(sig1).toBe(sig2);
  });
});

describe('deduplicateTransactions', () => {
  it('removes exact duplicates', () => {
    const existing = [makeTransaction({ date: '2024-01-15', amount: 100, description: 'Amazon' })];
    const incoming = [makeTransaction({ date: '2024-01-15', amount: 100, description: 'Amazon' })];
    const result = deduplicateTransactions(incoming, existing);
    expect(result).toHaveLength(0);
  });

  it('preserves unique transactions', () => {
    const existing = [makeTransaction({ id: 'e1', date: '2024-01-15', amount: 100, description: 'Amazon' })];
    const incoming = [makeTransaction({ id: 'n1', date: '2024-01-16', amount: 200, description: 'Flipkart' })];
    const result = deduplicateTransactions(incoming, existing);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('n1');
  });

  it('handles empty existing list', () => {
    const incoming = [makeTransaction({ date: '2024-01-15', amount: 100, description: 'Amazon' })];
    const result = deduplicateTransactions(incoming, []);
    expect(result).toHaveLength(1);
  });

  it('handles empty new list', () => {
    const existing = [makeTransaction({ date: '2024-01-15', amount: 100, description: 'Amazon' })];
    const result = deduplicateTransactions([], existing);
    expect(result).toHaveLength(0);
  });

  it('handles both lists empty', () => {
    expect(deduplicateTransactions([], [])).toHaveLength(0);
  });
});

describe('getCategoryType', () => {
  it('returns "expense" for expense categories', () => {
    const txn = makeTransaction({ category: makeCategory('shopping') });
    expect(getCategoryType(txn)).toBe('expense');
  });

  it('returns "income" for income categories', () => {
    const txn = makeTransaction({ category: makeCategory('income', CategoryType.Income) });
    expect(getCategoryType(txn)).toBe('income');
  });

  it('returns "excluded" for excluded categories', () => {
    const txn = makeTransaction({ category: makeCategory('transfer', CategoryType.Excluded) });
    expect(getCategoryType(txn)).toBe('excluded');
  });

  it('defaults to "expense" for unregistered category IDs', () => {
    const txn = makeTransaction({ category: makeCategory('totally-fake-id') });
    expect(getCategoryType(txn)).toBe('expense');
  });
});

describe('isIncome / isExpense / isExcluded', () => {
  it('isIncome returns true for income, false otherwise', () => {
    const income = makeTransaction({ category: makeCategory('income', CategoryType.Income) });
    const expense = makeTransaction({ category: makeCategory('shopping') });
    expect(isIncome(income)).toBe(true);
    expect(isIncome(expense)).toBe(false);
  });

  it('isExpense returns true for expense, false otherwise', () => {
    const expense = makeTransaction({ category: makeCategory('shopping') });
    const excluded = makeTransaction({ category: makeCategory('transfer', CategoryType.Excluded) });
    expect(isExpense(expense)).toBe(true);
    expect(isExpense(excluded)).toBe(false);
  });

  it('isExcluded returns true for excluded, false otherwise', () => {
    const excluded = makeTransaction({ category: makeCategory('transfer', CategoryType.Excluded) });
    const expense = makeTransaction({ category: makeCategory('shopping') });
    expect(isExcluded(excluded)).toBe(true);
    expect(isExcluded(expense)).toBe(false);
  });
});
