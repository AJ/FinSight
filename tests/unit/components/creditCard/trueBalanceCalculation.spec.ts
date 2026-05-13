import { describe, it, expect } from 'vitest';
import {
  computeTrueBalance,
  type TransactionLike,
} from '@/components/creditCard/trueBalanceCalculation';

function txn(overrides: Partial<TransactionLike>): TransactionLike {
  return {
    sourceType: 'bank',
    isIncome: false,
    isExpense: true,
    amount: 100,
    ...overrides,
  };
}

describe('computeTrueBalance', () => {
  it('returns zeros for empty transactions and no CC outstanding', () => {
    const result = computeTrueBalance([], 0);
    expect(result).toEqual({
      bankIncome: 0,
      bankExpenses: 0,
      bankBalance: 0,
      ccOutstanding: 0,
      trueBalance: 0,
    });
  });

  it('computes bank balance from income minus expenses', () => {
    const txns = [
      txn({ isIncome: true, isExpense: false, amount: 50000 }),
      txn({ isIncome: true, isExpense: false, amount: 10000 }),
      txn({ isExpense: true, isIncome: false, amount: 20000 }),
    ];

    const result = computeTrueBalance(txns, 0);
    expect(result.bankIncome).toBe(60000);
    expect(result.bankExpenses).toBe(20000);
    expect(result.bankBalance).toBe(40000);
    expect(result.trueBalance).toBe(40000);
  });

  it('subtracts CC outstanding from bank balance', () => {
    const txns = [
      txn({ isIncome: true, isExpense: false, amount: 80000 }),
      txn({ isExpense: true, isIncome: false, amount: 30000 }),
    ];

    const result = computeTrueBalance(txns, 15000);
    expect(result.bankBalance).toBe(50000);
    expect(result.ccOutstanding).toBe(15000);
    expect(result.trueBalance).toBe(35000);
  });

  it('excludes credit_card sourceType from bank calculation', () => {
    const txns = [
      txn({ isIncome: true, isExpense: false, amount: 50000, sourceType: 'bank' }),
      txn({ isExpense: true, isIncome: false, amount: 10000, sourceType: 'credit_card' }),
      txn({ isIncome: true, isExpense: false, amount: 5000, sourceType: 'credit_card' }),
    ];

    const result = computeTrueBalance(txns, 0);
    expect(result.bankIncome).toBe(50000);
    expect(result.bankExpenses).toBe(0);
    expect(result.bankBalance).toBe(50000);
  });

  it('produces negative true balance when CC debt exceeds bank balance', () => {
    const txns = [
      txn({ isIncome: true, isExpense: false, amount: 20000 }),
      txn({ isExpense: true, isIncome: false, amount: 15000 }),
    ];

    const result = computeTrueBalance(txns, 10000);
    expect(result.bankBalance).toBe(5000);
    expect(result.trueBalance).toBe(-5000);
  });

  it('uses absolute value for expense amounts', () => {
    const txns = [
      txn({ isIncome: true, isExpense: false, amount: 50000 }),
      txn({ isExpense: true, isIncome: false, amount: -30000 }),
    ];

    const result = computeTrueBalance(txns, 0);
    expect(result.bankExpenses).toBe(30000);
    expect(result.bankBalance).toBe(20000);
  });

  it('handles transactions that are both isIncome and isExpense', () => {
    // A transaction marked as both should count in both calculations
    const txns = [
      txn({ isIncome: true, isExpense: true, amount: 10000 }),
    ];

    const result = computeTrueBalance(txns, 0);
    expect(result.bankIncome).toBe(10000);
    expect(result.bankExpenses).toBe(10000);
    expect(result.bankBalance).toBe(0);
  });

  it('ignores transactions that are neither income nor expense', () => {
    const txns = [
      txn({ isIncome: false, isExpense: false, amount: 9999 }),
    ];

    const result = computeTrueBalance(txns, 0);
    expect(result.bankIncome).toBe(0);
    expect(result.bankExpenses).toBe(0);
    expect(result.bankBalance).toBe(0);
  });

  it('handles large CC outstanding with zero bank balance', () => {
    const result = computeTrueBalance([], 50000);
    expect(result.bankBalance).toBe(0);
    expect(result.ccOutstanding).toBe(50000);
    expect(result.trueBalance).toBe(-50000);
  });
});
