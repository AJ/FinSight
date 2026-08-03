import { describe, it, expect } from 'vitest';
import {
  computeInflow,
  computeOutflow,
  computeInvestments,
  computeDebtPayments,
  computeNetCashFlow,
  computeNetCashRate,
} from '@/lib/analytics/aggregation';
import { bucketTransactions } from '@/lib/analytics/routing';
import { makeTransaction, makeCategory } from '@tests/unit/factories';

describe('computeInflow', () => {
  it('sums income credits', () => {
    const txns = [
      makeTransaction({ amount: 100000, type: 'credit', category: makeCategory('salary', false) }),
      makeTransaction({ amount: 5000, type: 'credit', transactionSubType: 'interest', category: makeCategory('interest_income', false) }),
    ];
    const buckets = bucketTransactions(txns);
    expect(computeInflow(buckets)).toBe(105000);
  });

  it('includes rewards credits as inflow', () => {
    const txns = [
      makeTransaction({ amount: 100000, type: 'credit', category: makeCategory('salary', false) }),
      makeTransaction({ amount: 3000, type: 'credit', transactionSubType: 'rewards', category: makeCategory('shopping', true) }),
    ];
    const buckets = bucketTransactions(txns);
    expect(computeInflow(buckets)).toBe(103000);
  });

  it('returns 0 for empty input', () => {
    expect(computeInflow(bucketTransactions([]))).toBe(0);
  });

  it('returns 0 when only expenses exist (no income)', () => {
    const txns = [
      makeTransaction({ amount: 5000, type: 'debit', transactionSubType: 'purchase', category: makeCategory('shopping', true) }),
    ];
    expect(computeInflow(bucketTransactions(txns))).toBe(0);
  });
});

describe('computeOutflow', () => {
  it('sums expense debits minus refund offset credits', () => {
    const txns = [
      makeTransaction({ amount: 50000, type: 'debit', transactionSubType: 'purchase', category: makeCategory('shopping', true) }),
      makeTransaction({ amount: 3000, type: 'credit', transactionSubType: 'refund', category: makeCategory('shopping', true) }),
    ];
    const buckets = bucketTransactions(txns);
    expect(computeOutflow(buckets)).toBe(47000);
  });

  it('excludes CC bill payments (routed to debtPayments)', () => {
    const txns = [
      makeTransaction({ amount: 50000, type: 'debit', transactionSubType: 'purchase', category: makeCategory('shopping', true) }),
      makeTransaction({ amount: 30000, type: 'debit', transactionSubType: 'debt_payment', category: makeCategory('cc_bill_payment', false) }),
    ];
    const buckets = bucketTransactions(txns);
    expect(computeOutflow(buckets)).toBe(50000);
  });

  it('handles negative outflow when offsets exceed debits', () => {
    const txns = [
      makeTransaction({ amount: 2000, type: 'debit', transactionSubType: 'purchase', category: makeCategory('shopping', true) }),
      makeTransaction({ amount: 5000, type: 'credit', transactionSubType: 'refund', category: makeCategory('shopping', true) }),
    ];
    const buckets = bucketTransactions(txns);
    expect(computeOutflow(buckets)).toBe(-3000);
  });

  it('returns 0 for empty input', () => {
    expect(computeOutflow(bucketTransactions([]))).toBe(0);
  });

  it('sums multiple refund offsets together', () => {
    const txns = [
      makeTransaction({ amount: 10000, type: 'debit', transactionSubType: 'purchase', category: makeCategory('shopping', true) }),
      makeTransaction({ amount: 2000, type: 'credit', transactionSubType: 'refund', category: makeCategory('shopping', true) }),
      makeTransaction({ amount: 500, type: 'credit', transactionSubType: 'refund', category: makeCategory('shopping', true) }),
      makeTransaction({ amount: 1000, type: 'credit', transactionSubType: 'refund', category: makeCategory('shopping', true) }),
    ];
    const buckets = bucketTransactions(txns);
    expect(computeOutflow(buckets)).toBe(6500);
  });
});

describe('computeInvestments', () => {
  it('sums investment transactions', () => {
    const txns = [
      makeTransaction({ amount: 15000, type: 'debit', transactionSubType: 'investment', category: makeCategory('investment', true) }),
    ];
    const buckets = bucketTransactions(txns);
    expect(computeInvestments(buckets)).toBe(15000);
  });

  it('returns 0 for empty input', () => {
    expect(computeInvestments(bucketTransactions([]))).toBe(0);
  });

  it('sums multiple investment transactions', () => {
    const txns = [
      makeTransaction({ amount: 5000, type: 'debit', transactionSubType: 'investment', category: makeCategory('investment', true) }),
      makeTransaction({ amount: 10000, type: 'debit', transactionSubType: 'investment', category: makeCategory('investment', true) }),
    ];
    expect(computeInvestments(bucketTransactions(txns))).toBe(15000);
  });
});

describe('computeDebtPayments', () => {
  it('sums debt transactions', () => {
    const txns = [
      makeTransaction({ amount: 5000, type: 'debit', transactionSubType: 'debt_payment', category: makeCategory('loans', false) }),
    ];
    const buckets = bucketTransactions(txns);
    expect(computeDebtPayments(buckets)).toBe(5000);
  });

  it('returns 0 for empty input', () => {
    expect(computeDebtPayments(bucketTransactions([]))).toBe(0);
  });

  it('sums CC bill payment + loan EMI together', () => {
    const txns = [
      makeTransaction({ amount: 30000, type: 'debit', transactionSubType: 'debt_payment', category: makeCategory('cc_bill_payment', false) }),
      makeTransaction({ amount: 15000, type: 'debit', transactionSubType: 'debt_payment', category: makeCategory('loans', false) }),
    ];
    expect(computeDebtPayments(bucketTransactions(txns))).toBe(45000);
  });
});

describe('computeNetCashFlow', () => {
  it('computes Inflow - Outflow - Investments - DebtPayments', () => {
    const txns = [
      makeTransaction({ amount: 120000, type: 'credit', category: makeCategory('salary', false) }),
      makeTransaction({ amount: 72000, type: 'debit', transactionSubType: 'purchase', category: makeCategory('shopping', true) }),
      makeTransaction({ amount: 3000, type: 'credit', transactionSubType: 'rewards', category: makeCategory('shopping', true) }),
      makeTransaction({ amount: 15000, type: 'debit', transactionSubType: 'investment', category: makeCategory('investment', true) }),
      makeTransaction({ amount: 5000, type: 'debit', transactionSubType: 'debt_payment', category: makeCategory('loans', false) }),
    ];
    const buckets = bucketTransactions(txns);
    expect(computeNetCashFlow(buckets)).toBe(31000);
  });

  it('returns 0 when all buckets are empty', () => {
    expect(computeNetCashFlow(bucketTransactions([]))).toBe(0);
  });

  it('produces negative net position when spending exceeds income', () => {
    const txns = [
      makeTransaction({ amount: 50000, type: 'credit', category: makeCategory('salary', false) }),
      makeTransaction({ amount: 60000, type: 'debit', transactionSubType: 'purchase', category: makeCategory('shopping', true) }),
    ];
    expect(computeNetCashFlow(bucketTransactions(txns))).toBe(-10000);
  });
});

describe('computeNetCashRate', () => {
  it('computes Net Position / Inflow * 100', () => {
    const txns = [
      makeTransaction({ amount: 120000, type: 'credit', category: makeCategory('salary', false) }),
      makeTransaction({ amount: 72000, type: 'debit', transactionSubType: 'purchase', category: makeCategory('shopping', true) }),
    ];
    const buckets = bucketTransactions(txns);
    expect(computeNetCashRate(buckets)).toBeCloseTo(40, 1);
  });

  it('returns 0 when inflow is 0', () => {
    const buckets = bucketTransactions([]);
    expect(computeNetCashRate(buckets)).toBe(0);
  });

  it('returns negative rate when net position is negative', () => {
    const txns = [
      makeTransaction({ amount: 50000, type: 'credit', category: makeCategory('salary', false) }),
      makeTransaction({ amount: 60000, type: 'debit', transactionSubType: 'purchase', category: makeCategory('shopping', true) }),
    ];
    expect(computeNetCashRate(bucketTransactions(txns))).toBeCloseTo(-20, 1);
  });

  it('returns 100 when there is inflow and zero outflow', () => {
    const txns = [
      makeTransaction({ amount: 100000, type: 'credit', category: makeCategory('salary', false) }),
    ];
    expect(computeNetCashRate(bucketTransactions(txns))).toBe(100);
  });
});
