import { describe, it, expect } from 'vitest';
import { mergeOutputs } from '@/lib/verification/mergeEngine';
import type { BankSummary, CCSummary } from '@/lib/parsers/extractSummary';
import { makeExtractedTransaction as makeTxn } from '@tests/unit/factories';

describe('mergeOutputs — bank statement', () => {
  it('merges valid bank extraction', () => {
    const summary = {
      statementDate: '2024-01-31',
      statementPeriodStart: '2024-01-01',
      statementPeriodEnd: '2024-01-31',
      openingBalance: 50000,
      closingBalance: 75000,
    };
    const transactions = [
      makeTxn({ description: 'AMAZON', amount: 1299, type: 'debit', balance: 48701 }),
      makeTxn({ description: 'SALARY', amount: 50000, type: 'credit', balance: 75000 }),
    ];
    const result = mergeOutputs('bank', summary as BankSummary, { transactions }, null, []);
    expect(result.statementType).toBe('bank');
    expect(result.summary).toEqual(summary);
    expect(result.transactions).toHaveLength(2);
    expect(result.derived.totalDebit).toBe(1299);
    expect(result.derived.totalCredit).toBe(50000);
    expect(result.derived.transactionCount).toBe(2);
    expect(result.meta.confidence).toBeGreaterThan(0);
    expect(result.rewards).toBeNull();
  });

  it('warns when summary is null', () => {
    const result = mergeOutputs('bank', null, { transactions: [makeTxn()] }, null, []);
    expect(result.summary).toBeNull();
    expect(result.transactions).toHaveLength(1);
    expect(result.meta.warnings.some(w => w.includes('Summary extraction failed'))).toBe(true);
  });

  it('warns when transactions are null', () => {
    const result = mergeOutputs(
      'bank',
      { statementDate: '2024-01-31', statementPeriodStart: null, statementPeriodEnd: null, openingBalance: null, closingBalance: null } as BankSummary,
      null,
      null,
      [],
    );
    expect(result.meta.warnings.some(w => w.includes('Transaction extraction failed'))).toBe(true);
    expect(result.transactions).toEqual([]);
  });

  it('warns when bank balance does not reconcile', () => {
    const summary = {
      statementDate: '2024-01-31',
      statementPeriodStart: '2024-01-01',
      statementPeriodEnd: '2024-01-31',
      openingBalance: 50000,
      closingBalance: 100000, // Doesn't match last txn balance
    };
    const transactions = [
      makeTxn({ description: 'TXN1', amount: 100, type: 'debit', balance: 50000 }),
      makeTxn({ description: 'TXN2', amount: 200, type: 'debit', balance: 49800 }),
    ];
    const result = mergeOutputs('bank', summary as BankSummary, { transactions }, null, []);
    expect(result.meta.warnings.some(w => w.includes('Balance reconciliation'))).toBe(true);
  });

  it('warns on bank balance mismatch, no warning when reconciled', () => {
    const summary = {
      statementDate: '2024-01-31',
      statementPeriodStart: '2024-01-01',
      statementPeriodEnd: '2024-01-31',
      openingBalance: 49900,
      closingBalance: 49800,
    };
    const transactions = [
      makeTxn({ description: 'TXN1', amount: 100, type: 'debit', balance: 49900 }),
      makeTxn({ description: 'TXN2', amount: 100, type: 'debit', balance: 49800 }),
    ];
    const result = mergeOutputs('bank', summary as BankSummary, { transactions }, null, []);
    expect(result.meta.warnings.some(w => w.includes('first transaction balance'))).toBe(false);
    expect(result.meta.warnings.some(w => w.includes('last transaction balance'))).toBe(false);
  });
});

describe('mergeOutputs — credit card statement', () => {
  it('merges valid CC extraction', () => {
    const summary = {
      statementDate: '2024-01-31',
      creditLimit: 100000,
      totalDue: 25000,
      minimumDue: 2500,
      availableCredit: 75000,
      previousBalance: 30000,
    };
    const transactions = [
      makeTxn({ description: 'AMAZON', amount: 5000, type: 'debit' }),
      makeTxn({ description: 'PAYMENT', amount: 10000, type: 'credit' }),
    ];
    const rewards = { cashback: 100, rewardPoints: { opening: 0, earned: 500, redeemed: 0, closing: 500 } };
    const result = mergeOutputs('credit_card', summary as CCSummary, { transactions }, rewards, []);
    expect(result.statementType).toBe('credit_card');
    expect(result.transactions).toHaveLength(2);
    expect(result.rewards).toEqual(rewards);
    expect(result.derived.totalDebit).toBe(5000);
    expect(result.derived.totalCredit).toBe(10000);
  });

  it('sets rewards to null for CC when not provided', () => {
    const result = mergeOutputs(
      'credit_card',
      { statementDate: '2024-01-31', creditLimit: 100000, totalDue: 0, minimumDue: 0, availableCredit: 100000, previousBalance: 0 } as CCSummary,
      { transactions: [makeTxn()] },
      null,
      [],
    );
    expect(result.rewards).toBeNull();
  });

  it('ignores rewards for bank statement', () => {
    const rewards = { cashback: 100, rewardPoints: { opening: 0, earned: 500, redeemed: 0, closing: 500 } };
    const result = mergeOutputs(
      'bank',
      { statementDate: '2024-01-31', statementPeriodStart: null, statementPeriodEnd: null, openingBalance: null, closingBalance: null } as BankSummary,
      { transactions: [makeTxn()] },
      rewards,
      [],
    );
    expect(result.rewards).toBeNull();
  });

  it('warns on CC cross-section mismatch', () => {
    const summary = {
      statementDate: '2024-01-31',
      creditLimit: 100000,
      totalDue: 25000,
      minimumDue: 2500,
      availableCredit: 75000,
      previousBalance: 30000,
      purchasesAndCharges: 100000, // Much higher than transactions
      paymentsReceived: 0,
    };
    const transactions = [
      makeTxn({ description: 'TXN1', amount: 1000, type: 'debit' }),
    ];
    const result = mergeOutputs('credit_card', summary as CCSummary, { transactions }, null, []);
    expect(result.meta.warnings.some(w => w.includes('cross-section'))).toBe(true);
  });
});

describe('mergeOutputs — deduplication', () => {
  it('flags potential duplicates but keeps all transactions', () => {
    const transactions = [
      makeTxn({ description: 'AMAZON IN', amount: 1299, type: 'debit' }),
      makeTxn({ description: 'AMAZON IN', amount: 1299, type: 'debit' }), // Near duplicate
    ];
    const result = mergeOutputs('bank', null, { transactions }, null, []);
    expect(result.transactions).toHaveLength(2);
    expect(result.meta.warnings.some(w => w.includes('potential duplicate'))).toBe(true);
  });

  it('reports correct count of potential duplicates in warning', () => {
    const transactions = [
      makeTxn({ description: 'AMAZON IN', amount: 1299, type: 'debit' }),
      makeTxn({ description: 'AMAZON IN', amount: 1299, type: 'debit' }),
      makeTxn({ description: 'AMAZON IN', amount: 1299, type: 'debit' }),
    ];
    const result = mergeOutputs('bank', null, { transactions }, null, []);
    expect(result.transactions).toHaveLength(3);
    expect(result.meta.warnings.some(w => w.includes('2 potential duplicate'))).toBe(true);
  });

  it('reduces confidence for each potential duplicate', () => {
    const noDupResult = mergeOutputs('bank', null, {
      transactions: [makeTxn({ description: 'AMAZON', amount: 1299 })],
    }, null, []);
    const dupResult = mergeOutputs('bank', null, {
      transactions: [
        makeTxn({ description: 'AMAZON IN', amount: 1299 }),
        makeTxn({ description: 'AMAZON IN', amount: 1299 }),
      ],
    }, null, []);
    expect(dupResult.meta.confidence).toBeLessThan(noDupResult.meta.confidence);
  });

  it('does not flag transactions with different amounts', () => {
    const transactions = [
      makeTxn({ description: 'AMAZON', amount: 1299, type: 'debit' }),
      makeTxn({ description: 'AMAZON', amount: 1300, type: 'debit' }),
    ];
    const result = mergeOutputs('bank', null, { transactions }, null, []);
    expect(result.meta.warnings.some(w => w.includes('potential duplicate'))).toBe(false);
  });

  it('does not flag transactions with different dates', () => {
    const transactions = [
      makeTxn({ description: 'AMAZON', amount: 1299, type: 'debit', date: '2024-01-15' }),
      makeTxn({ description: 'AMAZON', amount: 1299, type: 'debit', date: '2024-01-16' }),
    ];
    const result = mergeOutputs('bank', null, { transactions }, null, []);
    expect(result.meta.warnings.some(w => w.includes('potential duplicate'))).toBe(false);
  });

  it('preserves genuinely different transactions', () => {
    const transactions = [
      makeTxn({ description: 'AMAZON', amount: 1299, type: 'debit' }),
      makeTxn({ description: 'SWIGGY', amount: 350, type: 'debit' }),
      makeTxn({ description: 'NETFLIX', amount: 649, type: 'debit' }),
    ];
    const result = mergeOutputs('bank', null, { transactions }, null, []);
    expect(result.transactions).toHaveLength(3);
  });
});

describe('mergeOutputs — confidence scoring', () => {
  it('returns confidence 1.0 with no warnings', () => {
    const result = mergeOutputs(
      'bank',
      { statementDate: '2024-01-31', statementPeriodStart: null, statementPeriodEnd: null, openingBalance: null, closingBalance: null } as BankSummary,
      { transactions: [makeTxn()] },
      null,
      [],
    );
    expect(result.meta.confidence).toBe(1.0);
  });

  it('reduces confidence when summary extraction failed', () => {
    const result = mergeOutputs('bank', null, { transactions: [makeTxn()] }, null, []);
    expect(result.meta.confidence).toBeLessThan(1.0);
  });

  it('reduces confidence for cross-section warnings', () => {
    const summary = {
      statementDate: '2024-01-31',
      creditLimit: 100000,
      totalDue: 25000,
      minimumDue: 2500,
      availableCredit: 75000,
      previousBalance: 30000,
      purchasesAndCharges: 100000,
      paymentsReceived: 0,
    };
    const result = mergeOutputs('credit_card', summary as CCSummary, { transactions: [makeTxn({ amount: 1000, type: 'debit' })] }, null, []);
    expect(result.meta.confidence).toBeLessThan(1.0);
  });

  it('reduces confidence for balance reconciliation warnings', () => {
    const summary = {
      statementDate: '2024-01-31',
      statementPeriodStart: '2024-01-01',
      statementPeriodEnd: '2024-01-31',
      openingBalance: 50000,
      closingBalance: 99999,
    };
    const transactions = [
      makeTxn({ amount: 100, type: 'debit', balance: 50000 }),
      makeTxn({ amount: 200, type: 'debit', balance: 49700 }),
    ];
    const result = mergeOutputs('bank', summary as BankSummary, { transactions }, null, []);
    expect(result.meta.warnings.some(w => w.includes('Balance reconciliation'))).toBe(true);
    expect(result.meta.confidence).toBeLessThan(1.0);
  });
});

describe('mergeOutputs — passes upstream warnings through', () => {
  it('includes upstream warnings in final result', () => {
    const result = mergeOutputs(
      'bank',
      null,
      { transactions: [makeTxn()] },
      null,
      ['LLM connection timed out'],
    );
    expect(result.meta.warnings).toContain('LLM connection timed out');
  });
});

describe('mergeOutputs — failed chunks tracking', () => {
  it('records failed chunks in meta', () => {
    const result = mergeOutputs(
      'bank',
      null,
      { transactions: [makeTxn()] },
      null,
      [],
      ['Chunk 2 failed: timeout', 'Chunk 4 failed: invalid JSON'],
    );
    expect(result.meta.failedChunks).toEqual(['Chunk 2 failed: timeout', 'Chunk 4 failed: invalid JSON']);
  });
});

describe('mergeOutputs — derived totals computation', () => {
  it('correctly sums debits and credits', () => {
    const transactions = [
      makeTxn({ amount: 100, type: 'debit' }),
      makeTxn({ amount: 200, type: 'debit' }),
      makeTxn({ amount: 50, type: 'credit' }),
      makeTxn({ amount: 300, type: 'credit' }),
    ];
    const result = mergeOutputs('bank', null, { transactions }, null, []);
    expect(result.derived.totalDebit).toBe(300);
    expect(result.derived.totalCredit).toBe(350);
    expect(result.derived.transactionCount).toBe(4);
  });

  it('handles empty transactions', () => {
    const result = mergeOutputs('bank', null, { transactions: [] }, null, []);
    expect(result.derived.totalDebit).toBe(0);
    expect(result.derived.totalCredit).toBe(0);
    expect(result.derived.transactionCount).toBe(0);
  });
});
