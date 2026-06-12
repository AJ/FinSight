import { describe, it, expect } from 'vitest';
import { routeTransaction } from '@/lib/analytics/routing';
import { makeTransaction, makeCategory } from '@tests/unit/factories';
import { CategoryType } from '@/types';

describe('Suspense resolution — category type determines routing', () => {
  it('routes resolved cc_bill_payment (DebtPayment) to debtPayments', () => {
    const resolved = makeTransaction({
      amount: 30000,
      type: 'debit',
      transactionSubType: 'transfer',
      category: makeCategory('cc_bill_payment', CategoryType.DebtPayment),
    });
    expect(routeTransaction(resolved)).toBe('debtPayments');
  });

  it('routes resolved loans (DebtPayment) to debtPayments', () => {
    const resolved = makeTransaction({
      amount: 15000,
      type: 'debit',
      transactionSubType: 'transfer',
      category: makeCategory('loans', CategoryType.DebtPayment),
    });
    expect(routeTransaction(resolved)).toBe('debtPayments');
  });

  it('routes resolved investment (Investment) to investments', () => {
    const resolved = makeTransaction({
      amount: 10000,
      type: 'debit',
      transactionSubType: 'transfer',
      category: makeCategory('investment', CategoryType.Investment),
    });
    expect(routeTransaction(resolved)).toBe('investments');
  });

  it('routes resolved expense category to outflow', () => {
    const resolved = makeTransaction({
      amount: 5000,
      type: 'debit',
      transactionSubType: 'transfer',
      category: makeCategory('dining', CategoryType.Expense),
    });
    expect(routeTransaction(resolved)).toBe('outflow');
  });

  it('routes resolved income category to inflow', () => {
    const resolved = makeTransaction({
      amount: 50000,
      type: 'credit',
      transactionSubType: 'transfer',
      category: makeCategory('salary', CategoryType.Income),
    });
    expect(routeTransaction(resolved)).toBe('inflow');
  });

  it('routes resolved excluded category to excluded', () => {
    const resolved = makeTransaction({
      amount: 5000,
      type: 'debit',
      transactionSubType: 'transfer',
      category: makeCategory('transfer', CategoryType.Excluded),
    });
    expect(routeTransaction(resolved)).toBe('excluded');
  });
});

describe('Suspense resolution — subType stays as transfer', () => {
  it('preserves transfer subType when resolving to cc_bill_payment', () => {
    const txn = makeTransaction({
      amount: 30000,
      transactionSubType: 'transfer',
      category: makeCategory('shopping', CategoryType.Expense),
    });

    const resolved = txn.cloneWith({
      category: 'cc_bill_payment',
      isSuspense: false,
    });

    expect(resolved.category.id).toBe('cc_bill_payment');
    expect(resolved.transactionSubType).toBe('transfer');
    expect(resolved.isSuspense).toBe(false);
  });

  it('preserves transfer subType when resolving to investment', () => {
    const txn = makeTransaction({
      amount: 10000,
      transactionSubType: 'transfer',
      category: makeCategory('shopping', CategoryType.Expense),
    });

    const resolved = txn.cloneWith({
      category: 'investment',
      isSuspense: false,
    });

    expect(resolved.category.id).toBe('investment');
    expect(resolved.transactionSubType).toBe('transfer');
    expect(resolved.isSuspense).toBe(false);
  });

  it('preserves transfer subType when resolving to loans', () => {
    const txn = makeTransaction({
      amount: 20000,
      transactionSubType: 'transfer',
      category: makeCategory('transfer', CategoryType.Excluded),
    });

    const resolved = txn.cloneWith({
      category: 'loans',
      isSuspense: false,
    });

    expect(resolved.category.id).toBe('loans');
    expect(resolved.transactionSubType).toBe('transfer');
    expect(resolved.isSuspense).toBe(false);
  });

  it('preserves purchase subType when resolving to a non-override expense', () => {
    const txn = makeTransaction({
      amount: 500,
      transactionSubType: 'purchase',
      category: makeCategory('shopping', CategoryType.Expense),
    });

    const resolved = txn.cloneWith({
      category: 'dining',
      isSuspense: false,
    });

    expect(resolved.category.id).toBe('dining');
    expect(resolved.transactionSubType).toBe('purchase');
    expect(resolved.isSuspense).toBe(false);
  });
});
