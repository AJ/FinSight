import { describe, it, expect } from 'vitest';
import { mergeOutputs } from '@/lib/verification/mergeEngine';
import { mergeChunkTransactions } from '@/lib/parsers/transactionChunking';
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

  it('runs bank cross-section validation when accountNumber is present', () => {
    // The mergeEngine checks `'accountNumber' in summary` to decide whether
    // to call validateBankCrossSection. This test includes accountNumber
    // to exercise that branch (line 194).
    const summary = {
      statementDate: '2024-01-31',
      statementPeriodStart: '2024-01-01',
      statementPeriodEnd: '2024-01-31',
      openingBalance: 50000,
      closingBalance: 100000, // Doesn't match: 50000 + 1000(credit) - 500(debit) = 50500 ≠ 100000
      accountNumber: '1234567890',
    };
    const transactions = [
      makeTxn({ description: 'SALARY', amount: 1000, type: 'credit' }),
      makeTxn({ description: 'AMAZON', amount: 500, type: 'debit' }),
    ];
    const result = mergeOutputs('bank', summary as BankSummary, { transactions }, null, []);
    // Should have cross-section warning from validateBankCrossSection
    expect(result.meta.warnings.some(w => w.includes('cross-section') || w.includes('openingBalance'))).toBe(true);
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

describe('mergeOutputs — chunk overlap amount conflicts', () => {
  it('mergeEngine does not flag amount-conflicting transactions as near-duplicates', () => {
    // Tests mergeEngine's near-duplicate detection specifically — it uses <0.01 tolerance.
    // Amount conflicts are now resolved upstream by mergeChunkTransactions,
    // but if they reach mergeEngine directly, they should not be conflated.
    const txn1 = makeTxn({ description: 'AMAZON RETAIL', amount: 1299, type: 'debit', date: '2024-01-15' });
    const txn2 = makeTxn({ description: 'AMAZON RETAIL', amount: 1399, type: 'debit', date: '2024-01-15' });

    const result = mergeOutputs('bank', null, { transactions: [txn1, txn2] }, null, []);

    // mergeEngine's near-duplicate uses <0.01 amount tolerance → 100 diff → not flagged
    expect(result.transactions).toHaveLength(2);
    expect(result.meta.warnings.some(w => w.includes('potential duplicate'))).toBe(false);
  });

  it('flags near-duplicate when amounts differ by less than 0.01', () => {
    // 1299.00 vs 1299.009 → diff = 0.009 < 0.01 threshold
    const txn1 = makeTxn({ description: 'AMAZON RETAIL', amount: 1299.00, type: 'debit', date: '2024-01-15' });
    const txn2 = makeTxn({ description: 'AMAZON RETAIL', amount: 1299.009, type: 'debit', date: '2024-01-15' });

    const result = mergeOutputs('bank', null, { transactions: [txn1, txn2] }, null, []);

    expect(result.transactions).toHaveLength(2); // kept all
    expect(result.meta.warnings.some(w => w.includes('potential duplicate'))).toBe(true);
  });

  it('amounts clearly above 0.01 threshold are not near-duplicates', () => {
    // 1299 vs 1300 → diff = 1.0, clearly above the 0.01 threshold
    // Note: exact 0.01 boundary is unreliable due to IEEE 754 floating point
    // (1299.01 - 1299.00 can evaluate to < 0.01 in JS)
    const txn1 = makeTxn({ description: 'AMAZON RETAIL', amount: 1299, type: 'debit', date: '2024-01-15' });
    const txn2 = makeTxn({ description: 'AMAZON RETAIL', amount: 1300, type: 'debit', date: '2024-01-15' });

    const result = mergeOutputs('bank', null, { transactions: [txn1, txn2] }, null, []);

    expect(result.transactions).toHaveLength(2);
    expect(result.meta.warnings.some(w => w.includes('potential duplicate'))).toBe(false);
  });

  it('chunk overlap amount conflict is resolved at chunk merge layer', () => {
    // Full pipeline: chunk merge → mergeOutputs
    const chunk1Results = [
      makeTxn({ description: 'AMAZON RETAIL', amount: 1299, type: 'debit', date: '2024-01-15', confidence: 0.7 }),
    ];
    const chunk2Results = [
      makeTxn({ description: 'AMAZON RETAIL', amount: 1399, type: 'debit', date: '2024-01-15', confidence: 0.9 }),
    ];

    // Layer 1: mergeChunkTransactions resolves the amount conflict
    const merged = mergeChunkTransactions([...chunk1Results, ...chunk2Results]);
    expect(merged.transactions).toHaveLength(1);
    expect(merged.conflictsResolved).toBe(1);
    expect(merged.transactions[0].amount).toBe(1399); // higher confidence wins
    expect(merged.transactions[0].confidence).toBe(0.9);

    // Layer 2: mergeOutputs sees a single clean transaction
    const result = mergeOutputs('bank', null, { transactions: merged.transactions }, null, []);
    expect(result.transactions).toHaveLength(1);
    expect(result.meta.warnings.some(w => w.includes('potential duplicate'))).toBe(false);
  });

  it('identical overlap transactions are deduped at chunk level', () => {
    // When both chunks agree on amount, chunk merge deduplicates correctly
    const chunk1Results = [
      makeTxn({ description: 'AMAZON RETAIL', amount: 1299, type: 'debit', date: '2024-01-15', confidence: 0.7 }),
    ];
    const chunk2Results = [
      makeTxn({ description: 'AMAZON RETAIL', amount: 1299, type: 'debit', date: '2024-01-15', confidence: 0.9 }),
    ];

    const merged = mergeChunkTransactions([...chunk1Results, ...chunk2Results]);
    expect(merged.transactions).toHaveLength(1);
    expect(merged.duplicatesRemoved).toBe(1);
    expect(merged.transactions[0].confidence).toBe(0.9); // kept higher confidence
  });

  it('description similarity alone is insufficient without amount match', () => {
    // Identical description + same date, but different amounts → no near-duplicate flag
    const txn1 = makeTxn({ description: 'SWIGGY ORDER #12345', amount: 450, type: 'debit', date: '2024-01-15' });
    const txn2 = makeTxn({ description: 'SWIGGY ORDER #12345', amount: 550, type: 'debit', date: '2024-01-15' });

    const result = mergeOutputs('bank', null, { transactions: [txn1, txn2] }, null, []);

    expect(result.transactions).toHaveLength(2);
    expect(result.meta.warnings.some(w => w.includes('potential duplicate'))).toBe(false);
  });
});
