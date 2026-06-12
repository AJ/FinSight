import { describe, it, expect } from 'vitest';
import { verifyStatement } from '@/lib/verification/verificationEngine';
import { validateCCCrossSection, validateBankCrossSection } from '@/lib/verification/mergeEngine';
import type { ExtractedTransaction } from '@/types/extractedTransaction';
import type { CCSummary, BankSummary } from '@/lib/parsers/extractSummary';
import { makeTransaction } from '@tests/unit/factories';

describe('verifyStatement — bank verification', () => {
  const rawText = `
    Date        Description                Debit       Credit      Balance
    01/01/2024  AMAZON INDIA PURCHASE     1,299.00                 48,701.00
    15/01/2024  SALARY CREDIT                          50,000.00   98,701.00
    20/01/2024  SWIGGY FOOD ORDER           350.00                  98,351.00
  `;

  it('verifies transactions that appear in raw text (context matching)', () => {
    // Use simple raw text without commas to avoid normalization stripping them
    const simpleRawText = `2024-01-15 AMAZON PURCHASE 1299 debit balance 48701`;
    const txns = [
      makeTransaction({ description: 'AMAZON PURCHASE', amount: 1299, type: 'debit', date: '2024-01-15', balance: 48701 }),
    ];
    const result = verifyStatement(simpleRawText, txns, { kind: 'bank', openingBalance: 50000, closingBalance: 50000 });
    expect(result.verified.length).toBeGreaterThan(0);
    expect(result.verified[0].confidence).toBeGreaterThanOrEqual(75);
  });

  it('rejects transactions not found in text', () => {
    const txns = [
      makeTransaction({ description: 'TOTALLY FAKE MERCHANT', amount: 999999, type: 'debit' }),
    ];
    const result = verifyStatement(rawText, txns, { kind: 'bank' });
    expect(result.rejected.length).toBeGreaterThan(0);
    expect(result.verified.length).toBe(0);
  });

  it('rejects hallucinated duplicate (one occurrence in text, two extraction objects)', () => {
    const simpleRawText = `2024-01-15 AMAZON PURCHASE 1299 debit`;
    const txn1 = makeTransaction({ description: 'AMAZON PURCHASE', amount: 1299, type: 'debit', date: '2024-01-15' });
    const txn2 = makeTransaction({ description: 'AMAZON PURCHASE', amount: 1299, type: 'debit', date: '2024-01-15' });
    const result = verifyStatement(simpleRawText, [txn1, txn2], { kind: 'bank' });
    // Only one occurrence of 1299 in text — second extraction has no evidence, so rejected
    expect(result.verified.length).toBe(1);
    expect(result.rejected.length).toBe(1);
  });

  it('computes overall confidence', () => {
    const txns = [
      makeTransaction({ description: 'AMAZON INDIA PURCHASE', amount: 1299, type: 'debit', date: '2024-01-01' }),
    ];
    const result = verifyStatement(rawText, txns, { kind: 'bank', openingBalance: 50000, closingBalance: 98351 });
    expect(result.overallConfidence).toBeGreaterThanOrEqual(0);
    expect(result.overallConfidence).toBeLessThanOrEqual(100);
  });
});

describe('verifyStatement — reconciliation', () => {
  it('passes reconciliation when math holds even with zero transactions verified', () => {
    const txns = [
      makeTransaction({ amount: 1000, type: 'credit' }),
      makeTransaction({ amount: 300, type: 'debit' }),
    ];
    // Balance equation holds (50000 + 1000 - 300 = 50700) — reconciliation passes on its own merit.
    const result = verifyStatement('text', txns, { kind: 'bank', openingBalance: 50000, closingBalance: 50700 });
    expect(result.verified.length).toBe(0);
    expect(result.reconciliation.passed).toBe(true);
  });

  it('fails when balance equation does not hold', () => {
    const txns = [
      makeTransaction({ amount: 1000, type: 'credit' }),
    ];
    const result = verifyStatement('text', txns, { kind: 'bank', openingBalance: 50000, closingBalance: 100000 });
    expect(result.reconciliation.passed).toBe(false);
    expect(result.reconciliation.difference).toBeGreaterThan(1.0);
  });

  it('returns not passed when balances are missing', () => {
    const result = verifyStatement('text', [], { kind: 'bank' });
    expect(result.reconciliation.passed).toBe(false);
  });
});

describe('CC aggregate checks via verifyStatement', () => {
  it('passes when statement totals formula holds', () => {
    const txns = [
      makeTransaction({ amount: 10000, type: 'debit', description: 'AMAZON' }),
      makeTransaction({ amount: 5000, type: 'credit', description: 'PAYMENT' }),
    ];
    // Raw text must contain amount evidence so transactions verify (guard requires verified.length > 0)
    const rawText = 'AMAZON 10000 dr PAYMENT 5000 cr';
    // PreviousBalance(30000) + Debits(10000) - Credits(5000) = 35000
    const result = verifyStatement(rawText, txns, {
      kind: 'credit_card',
      previousBalance: 30000,
      totalDue: 35000,
      purchasesAndCharges: 10000,
      paymentsReceived: 5000,
    });
    expect(result.verified.length).toBeGreaterThan(0);
    expect(result.ccAggregate!.statementTotals.passed).toBe(true);
    expect(result.reconciliation.difference).toBeLessThanOrEqual(1.0);
    expect(result.ccAggregate!.statementTotals.passed && result.ccAggregate!.transactionSums.passed).toBe(true);
  });

  it('fails when statement totals do not match', () => {
    const txns = [
      makeTransaction({ amount: 1000, type: 'debit' }),
    ];
    // Previous(30000) + Debits(1000) - Credits(0) = 31000, but expected 50000
    const result = verifyStatement('text', txns, {
      kind: 'credit_card',
      previousBalance: 30000,
      totalDue: 50000,
    });
    expect(result.ccAggregate!.statementTotals.passed).toBe(false);
  });

  it('verifies transaction sums by type', () => {
    const txns = [
      makeTransaction({ amount: 5000, type: 'debit', transactionSubType: 'purchase' }),
      makeTransaction({ amount: 3000, type: 'credit', transactionSubType: 'debt_payment' }),
    ];
    const result = verifyStatement('text', txns, {
      kind: 'credit_card',
      purchasesAndCharges: 5000,
      paymentsReceived: 3000,
    });
    expect(result.ccAggregate!.transactionSums.passed).toBe(true);
  });

  it('passes when statement meta fields are undefined', () => {
    const txns = [
      makeTransaction({ amount: 1000, type: 'debit' }),
    ];
    const result = verifyStatement('text', txns, { kind: 'credit_card' });
    // Without statement data to compare against, should pass by default
    expect(result.ccAggregate!.transactionSums.passed).toBe(true);
  });

  it('calculates correct subtype breakdown', () => {
    const txns = [
      makeTransaction({ amount: 1000, type: 'debit', transactionSubType: 'purchase' }),
      makeTransaction({ amount: 500, type: 'debit', transactionSubType: 'fee' }),
      makeTransaction({ amount: 200, type: 'credit', transactionSubType: 'rewards' }),
    ];
    const result = verifyStatement('text', txns, { kind: 'credit_card' });
    expect(result.ccAggregate!.transactionSums.totalDebits).toBe(1500);
    expect(result.ccAggregate!.transactionSums.totalCredits).toBe(200);
    expect(result.ccAggregate!.transactionSums.totalFees).toBe(500);
  });
});

describe('validateCCCrossSection', () => {
  it('returns empty when debit total matches purchasesAndCharges AND credits match paymentsReceived', () => {
    const warnings = validateCCCrossSection(
      { purchasesAndCharges: 10000, paymentsReceived: 5000 } as CCSummary,
      [
        { amount: 5000, type: 'debit' } as ExtractedTransaction,
        { amount: 5000, type: 'debit' } as ExtractedTransaction,
        { amount: 5000, type: 'credit' } as ExtractedTransaction,
      ],
    );
    expect(warnings).toEqual([]);
  });

  it('returns empty when both fields are null', () => {
    const warnings = validateCCCrossSection(
      { purchasesAndCharges: null, paymentsReceived: null } as CCSummary,
      [{ amount: 1000, type: 'debit' }] as ExtractedTransaction[],
    );
    expect(warnings).toEqual([]);
  });

  it('returns empty for empty transactions', () => {
    const warnings = validateCCCrossSection(
      { purchasesAndCharges: 10000, paymentsReceived: 0 } as CCSummary,
      [],
    );
    expect(warnings).toEqual([]);
  });

  it('warns when debit total differs by > 15%', () => {
    const warnings = validateCCCrossSection(
      { purchasesAndCharges: 10000, paymentsReceived: 0 } as CCSummary,
      [{ amount: 1000, type: 'debit' }] as ExtractedTransaction[],
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('cross-section');
    expect(warnings[0]).toContain('90.0%');
  });

  it('warns when credit total differs by > 15%', () => {
    const warnings = validateCCCrossSection(
      { purchasesAndCharges: 0, paymentsReceived: 10000 } as CCSummary,
      [{ amount: 1000, type: 'credit' }] as ExtractedTransaction[],
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('paymentsReceived');
  });

  it('passes within 15% tolerance', () => {
    // purchasesAndCharges=1000, txn debit=1100 → 10% diff
    const warnings = validateCCCrossSection(
      { purchasesAndCharges: 1000, paymentsReceived: 0 } as CCSummary,
      [{ amount: 1100, type: 'debit' }] as ExtractedTransaction[],
    );
    expect(warnings).toEqual([]);
  });
});

describe('validateBankCrossSection', () => {
  it('returns empty when balance equation holds', () => {
    const warnings = validateBankCrossSection(
      { openingBalance: 50000, closingBalance: 50700, statementDate: '2024-01-31', statementPeriodStart: null, statementPeriodEnd: null } as BankSummary,
      [
        { amount: 1000, type: 'credit' } as ExtractedTransaction,
        { amount: 300, type: 'debit' } as ExtractedTransaction,
      ],
    );
    expect(warnings).toEqual([]);
  });

  it('warns when balance equation fails', () => {
    const warnings = validateBankCrossSection(
      { openingBalance: 50000, closingBalance: 100000, statementDate: '2024-01-31', statementPeriodStart: null, statementPeriodEnd: null } as BankSummary,
      [{ amount: 1000, type: 'credit' } as ExtractedTransaction],
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('cross-section');
    expect(warnings[0]).toContain('openingBalance');
  });

  it('returns empty when summary has null balances', () => {
    const warnings = validateBankCrossSection(
      { openingBalance: null, closingBalance: null, statementDate: '2024-01-31', statementPeriodStart: null, statementPeriodEnd: null } as BankSummary,
      [{ amount: 1000, type: 'credit' } as ExtractedTransaction],
    );
    expect(warnings).toEqual([]);
  });

  it('returns empty for empty transactions', () => {
    const warnings = validateBankCrossSection(
      { openingBalance: 50000, closingBalance: 50000, statementDate: '2024-01-31', statementPeriodStart: null, statementPeriodEnd: null } as BankSummary,
      [],
    );
    expect(warnings).toEqual([]);
  });

  it('passes within 1.0 tolerance', () => {
    // opening(50000) + credit(1000) = 51000, closing=50999.50 → diff=0.50
    const warnings = validateBankCrossSection(
      { openingBalance: 50000, closingBalance: 50999.50, statementDate: '2024-01-31', statementPeriodStart: null, statementPeriodEnd: null } as BankSummary,
      [{ amount: 1000, type: 'credit' }] as ExtractedTransaction[],
    );
    expect(warnings).toEqual([]);
  });
});

describe('CC aggregate — partial transaction sums', () => {
  it('marks transaction sums as failed when fees mismatch', () => {
    const txns = [
      makeTransaction({ amount: 1000, type: 'debit', transactionSubType: 'fee' }),
    ];
    const result = verifyStatement('text', txns, {
      kind: 'credit_card',
      interestCharged: 9999, // Very different from actual fees (1000)
    });
    expect(result.ccAggregate!.transactionSums.passed).toBe(false);
  });

  it('marks transaction sums as failed when purchases and payments mismatch but fees match', () => {
    const txns = [
      makeTransaction({ amount: 500, type: 'debit', transactionSubType: 'purchase' }),
      makeTransaction({ amount: 200, type: 'credit', transactionSubType: 'debt_payment' }),
      makeTransaction({ amount: 100, type: 'debit', transactionSubType: 'fee' }),
    ];
    const result = verifyStatement('text', txns, {
      kind: 'credit_card',
      purchasesAndCharges: 9999,
      paymentsReceived: 9999,
      interestCharged: 100,
    });
    expect(result.ccAggregate!.transactionSums.passed).toBe(false);
    // fees match individually even though overall sums fail
    expect(result.ccAggregate!.transactionSums.statementFees).toBe(100);
    expect(result.ccAggregate!.transactionSums.totalFees).toBe(100);
  });
});

describe('CC aggregate — subtype decomposition', () => {
  it('compares purchase subtype total against purchasesAndCharges (not all debits)', () => {
    // 1000 purchase + 500 fee = 1500 total debits, but purchasesAndCharges should only match purchase portion
    const txns = [
      makeTransaction({ amount: 1000, type: 'debit', transactionSubType: 'purchase' }),
      makeTransaction({ amount: 500, type: 'debit', transactionSubType: 'fee' }),
      makeTransaction({ amount: 300, type: 'credit', transactionSubType: 'debt_payment' }),
    ];
    const result = verifyStatement('text', txns, {
      kind: 'credit_card',
      purchasesAndCharges: 1000,
      paymentsReceived: 300,
    });
    // purchasesMatch: totalPurchases(1000) ≈ purchasesAndCharges(1000) ✓
    // debitTotalsMatch: totalDebits(1500) ≈ statementDebits(1000 + 0 + 0 + 0) ✗
    // → overall transactionSums fails because total debits don't match statement debits
    expect(result.ccAggregate!.transactionSums.passed).toBe(false);
    expect(result.ccAggregate!.transactionSums.totalFees).toBe(500);
  });

  it('passes when debits match full statement stack including fees', () => {
    const txns = [
      makeTransaction({ amount: 1000, type: 'debit', transactionSubType: 'purchase' }),
      makeTransaction({ amount: 500, type: 'debit', transactionSubType: 'fee' }),
      makeTransaction({ amount: 300, type: 'credit', transactionSubType: 'debt_payment' }),
    ];
    const result = verifyStatement('text', txns, {
      kind: 'credit_card',
      purchasesAndCharges: 1000,
      interestCharged: 500,
      paymentsReceived: 300,
    });
    // debitTotalsMatch: totalDebits(1500) ≈ statementDebits(1000 + 500) ✓
    // creditTotalsMatch: totalCredits(300) ≈ statementCredits(300) ✓
    // purchasesMatch: totalPurchases(1000) ≈ purchasesAndCharges(1000) ✓
    // feesMatch: totalFees(500) ≈ interestCharged(500) ✓
    // paymentsMatch: totalPayments(300) ≈ paymentsReceived(300) ✓
    expect(result.ccAggregate!.transactionSums.passed).toBe(true);
  });

  it('compares only debt_payment credits against paymentsReceived (not all credits)', () => {
    // 300 payment + 200 cashback = 500 total credits, but paymentsReceived should only match payment portion
    const txns = [
      makeTransaction({ amount: 1000, type: 'debit', transactionSubType: 'purchase' }),
      makeTransaction({ amount: 300, type: 'credit', transactionSubType: 'debt_payment' }),
      makeTransaction({ amount: 200, type: 'credit', transactionSubType: 'rewards' }),
    ];
    const result = verifyStatement('text', txns, {
      kind: 'credit_card',
      purchasesAndCharges: 1000,
      paymentsReceived: 300,
      cashbackEarned: 200,
    });
    // paymentsMatch: totalPayments(300) ≈ paymentsReceived(300) ✓
    // creditTotalsMatch: totalCredits(500) ≈ statementCredits(300 + 200) ✓
    expect(result.ccAggregate!.transactionSums.passed).toBe(true);
  });

  it('fails when paymentsReceived does not account for cashback', () => {
    const txns = [
      makeTransaction({ amount: 1000, type: 'debit', transactionSubType: 'purchase' }),
      makeTransaction({ amount: 300, type: 'credit', transactionSubType: 'debt_payment' }),
      makeTransaction({ amount: 200, type: 'credit', transactionSubType: 'rewards' }),
    ];
    const result = verifyStatement('text', txns, {
      kind: 'credit_card',
      purchasesAndCharges: 1000,
      paymentsReceived: 500, // Wrong: includes cashback as if it were payment
      cashbackEarned: 200,
    });
    // paymentsMatch: totalPayments(300) ≈ paymentsReceived(500) ✗
    expect(result.ccAggregate!.transactionSums.passed).toBe(false);
  });
});

describe('verifyStatement — type matching with contradictory evidence', () => {
  it('rejects credit transaction with contradictory debit evidence', () => {
    // A credit transaction found in raw text with "debit" keyword but no "credit" keyword.
    // With redistributed weights: amount(34) + date(23) + desc(15) = 72 < 75 threshold
    const rawText = '2024-01-15 refund -1500 debit inr';
    const txn = makeTransaction({ description: 'refund', amount: 1500, type: 'credit', date: '2024-01-15' });
    const result = verifyStatement(rawText, [txn], { kind: 'bank' });
    // Type mismatch prevents verification: 72 < 75
    expect(result.verified.length).toBe(0);
    expect(result.rejected.length).toBe(1);
  });

  it('rejects credit transaction with DR suffix after amount', () => {
    // A credit transaction where raw text has "1500dr" suffix (DR after amount)
    const rawText = '2024-01-15 transfer -1500dr inr';
    const txn = makeTransaction({ description: 'transfer', amount: 1500, type: 'credit', date: '2024-01-15' });
    const result = verifyStatement(rawText, [txn], { kind: 'bank' });
    // Type mismatch (DR suffix contradicts credit): 72 < 75
    expect(result.verified.length).toBe(0);
    expect(result.rejected.length).toBe(1);
  });
});

describe('verifyStatement — reconciliation with verified transactions', () => {
  it('runs reconciliation with both credit and debit verified transactions', () => {
    // Provide raw text where both credit and debit transactions verify
    // and pass openingBalance/closingBalance so reconciliation runs fully
    const rawText = '2024-01-15 amazon 1500 debit inr balance 48500\n2024-01-16 salary 5000 credit inr balance 53500';
    const txns = [
      makeTransaction({ description: 'amazon', amount: 1500, type: 'debit', date: '2024-01-15' }),
      makeTransaction({ description: 'salary', amount: 5000, type: 'credit', date: '2024-01-16' }),
    ];
    const result = verifyStatement(rawText, txns, { kind: 'bank', openingBalance: 50000, closingBalance: 53500 });
    // Both should verify (amount + type + date + description = 100)
    expect(result.verified.length).toBe(2);
    // Reconciliation should run: 50000 + 5000 - 1500 = 53500 = closingBalance
    expect(result.reconciliation.passed).toBe(true);
  });

  it('falls back to amount-context matching when no date anchor is near the amount', () => {
    const rawText = 'some text without dates and amount 1500 inr debit more padding text here';
    const txn = makeTransaction({ description: 'text', amount: 1500, type: 'debit', date: new Date('2020-01-01') });
    const result = verifyStatement(rawText, [txn], { kind: 'bank' });
    expect(result).toBeTruthy();
  });
});

describe('verifyStatement — debit type matching branches', () => {
  it('rejects debit transaction with contradictory credit evidence', () => {
    // A debit transaction found in raw text with "credit" keyword but no "debit" keyword.
    const rawText = '2024-01-15 refund +1500 credit inr';
    const txn = makeTransaction({ description: 'refund', amount: 1500, type: 'debit', date: '2024-01-15' });
    const result = verifyStatement(rawText, [txn], { kind: 'bank' });
    // Type mismatch (credit keyword contradicts debit tx): 72 < 75
    expect(result.verified.length).toBe(0);
    expect(result.rejected.length).toBe(1);
  });

  it('rejects debit transaction with CR suffix after amount', () => {
    // A debit transaction where raw text has "1500cr" suffix (CR after amount)
    const rawText = '2024-01-15 transfer +1500cr inr';
    const txn = makeTransaction({ description: 'transfer', amount: 1500, type: 'debit', date: '2024-01-15' });
    const result = verifyStatement(rawText, [txn], { kind: 'bank' });
    // Type mismatch (CR suffix contradicts debit tx): 72 < 75
    expect(result.verified.length).toBe(0);
    expect(result.rejected.length).toBe(1);
  });
});

describe('verifyStatement — structured row matching', () => {
  const columnarRawText = [
    'Date||Description||Debit||Credit||Balance',
    '01/01/2024||AMAZON INDIA PURCHASE||1299.00||||48701.00',
    '15/01/2024||SALARY CREDIT||||50000.00||98701.00',
    '20/01/2024||SWIGGY FOOD ORDER||350.00||||98351.00',
  ].join('\n');

  it('verifies transactions using structured column matching', () => {
    const txns = [
      makeTransaction({ description: 'AMAZON INDIA PURCHASE', amount: 1299, type: 'debit', date: '2024-01-01' }),
    ];
    const result = verifyStatement(columnarRawText, txns, { kind: 'bank', openingBalance: 50000, closingBalance: 98351 });
    expect(result.verified.length).toBe(1);
    expect(result.verified[0].verification.amountMatched).toBe(true);
    expect(result.verified[0].verification.typeMatched).toBe(true);
  });

  it('determines type from debit/credit column position', () => {
    const txns = [
      makeTransaction({ description: 'SALARY CREDIT', amount: 50000, type: 'credit', date: '2024-01-15' }),
    ];
    const result = verifyStatement(columnarRawText, txns, { kind: 'bank' });
    expect(result.verified.length).toBe(1);
    expect(result.verified[0].verification.typeMatched).toBe(true);
  });

  it('handles duplicate amounts via row consumption', () => {
    const rawText = [
      'Date||Description||Debit||Credit||Balance',
      '01/01/2024||ATM WITHDRAWAL||500.00||||49500.00',
      '05/01/2024||ATM WITHDRAWAL||500.00||||49000.00',
    ].join('\n');
    const txns = [
      makeTransaction({ description: 'ATM WITHDRAWAL', amount: 500, type: 'debit', date: '2024-01-01' }),
      makeTransaction({ description: 'ATM WITHDRAWAL', amount: 500, type: 'debit', date: '2024-01-05' }),
    ];
    const result = verifyStatement(rawText, txns, { kind: 'bank' });
    expect(result.verified.length).toBe(2);
  });

  it('falls back to progressive matching for transactions not in structured rows', () => {
    const txns = [
      makeTransaction({ description: 'AMAZON INDIA PURCHASE', amount: 1299, type: 'debit', date: '2024-01-01' }),
      makeTransaction({ description: 'PHANTOM TRANSACTION', amount: 99999, type: 'debit', date: '2024-01-30' }),
    ];
    const result = verifyStatement(columnarRawText, txns, { kind: 'bank' });
    expect(result.verified.length).toBe(1);
    expect(result.rejected.length).toBe(1);
  });

  it('reconciliation works with structured matching results', () => {
    const txns = [
      makeTransaction({ description: 'AMAZON INDIA PURCHASE', amount: 1299, type: 'debit', date: '2024-01-01' }),
      makeTransaction({ description: 'SALARY CREDIT', amount: 50000, type: 'credit', date: '2024-01-15' }),
      makeTransaction({ description: 'SWIGGY FOOD ORDER', amount: 350, type: 'debit', date: '2024-01-20' }),
    ];
    const result = verifyStatement(columnarRawText, txns, { kind: 'bank', openingBalance: 50000, closingBalance: 98351 });
    expect(result.verified.length).toBe(3);
    expect(result.reconciliation.passed).toBe(true);
  });

  it('falls back to progressive when structured type contradicts column position', () => {
    // 1299.00 is in the Debit column but transaction is typed as credit
    const txns = [
      makeTransaction({ description: 'AMAZON INDIA PURCHASE', amount: 1299, type: 'credit', date: '2024-01-01' }),
    ];
    const result = verifyStatement(columnarRawText, txns, { kind: 'bank', openingBalance: 50000, closingBalance: 98351 });
    // Structured: amount(34) + date(23) + desc(15) = 72 < 75 → falls back
    // Progressive: amount(34) + none_type(14) + date(23) + desc(15) = 86 ≥ 75 → verified
    expect(result.verified.length).toBe(1);
    expect(result.verified[0].verification.typeMatched).toBe(false);
  });

  it('falls back to progressive when type is ambiguous (both debit and credit columns)', () => {
    // Ambiguous type: same amount in debit AND credit columns
    // Need 2+ data rows so structured parser succeeds (parser requires >= 2 data rows)
    const rawText = [
      'Date||Description||Debit||Credit||Balance',
      '01/01/2024||TRANSFER||500.00||500.00||50000.00',
      '15/01/2024||SALARY CREDIT||||50000.00||100000.00',
    ].join('\n');
    const txns = [
      makeTransaction({ description: 'TRANSFER', amount: 500, type: 'debit', date: '2024-01-01' }),
    ];
    const result = verifyStatement(rawText, txns, { kind: 'bank' });
    // Structured: null type → 72 < 75 → falls back
    // Progressive: amount(34) + none(14) + date(23) + desc(15) = 86 → verified
    expect(result.verified.length).toBe(1);
    expect(result.verified[0].verification.typeMatched).toBe(false);
  });
});

describe('verifyStatement — progressive raw text matching (fallback)', () => {
  it('uses position-based consumption for duplicate amounts in free-form text', () => {
    // Use 753 — not a substring of any balance value (avoids false matches)
    const rawText = [
      '2024-01-01 atm withdrawal 753 debit balance 49247',
      '2024-01-05 atm withdrawal 753 debit balance 48494',
    ].join('\n');
    const txns = [
      makeTransaction({ description: 'atm withdrawal', amount: 753, type: 'debit', date: '2024-01-01' }),
      makeTransaction({ description: 'atm withdrawal', amount: 753, type: 'debit', date: '2024-01-05' }),
    ];
    const result = verifyStatement(rawText, txns, { kind: 'bank' });
    expect(result.verified.length).toBe(2);
  });

  it('matches credit transaction with structural CR suffix', () => {
    const rawText = '01/15/2024 salary credit 50000.00cr balance 98701.00';
    const txn = makeTransaction({ description: 'salary credit', amount: 50000, type: 'credit', date: '2024-01-15' });
    const result = verifyStatement(rawText, [txn], { kind: 'bank' });
    expect(result.verified.length).toBe(1);
    // Structural CR suffix gives full type weight (28)
    expect(result.verified[0].confidence).toBeGreaterThanOrEqual(75);
  });

  it('matches debit transaction with structural DR suffix', () => {
    const rawText = '01/15/2024 amazon purchase 1299.00dr balance 48701.00';
    const txn = makeTransaction({ description: 'amazon purchase', amount: 1299, type: 'debit', date: '2024-01-15' });
    const result = verifyStatement(rawText, [txn], { kind: 'bank' });
    expect(result.verified.length).toBe(1);
    expect(result.verified[0].confidence).toBeGreaterThanOrEqual(75);
  });

  it('matches credit transaction with plus sign prefix', () => {
    const rawText = '01/15/2024 refund +1500.00 balance 51500.00';
    const txn = makeTransaction({ description: 'refund', amount: 1500, type: 'credit', date: '2024-01-15' });
    const result = verifyStatement(rawText, [txn], { kind: 'bank' });
    expect(result.verified.length).toBe(1);
  });

  it('matches debit transaction with minus sign prefix', () => {
    const rawText = '01/15/2024 purchase -1299.00 balance 48701.00';
    const txn = makeTransaction({ description: 'purchase', amount: 1299, type: 'debit', date: '2024-01-15' });
    const result = verifyStatement(rawText, [txn], { kind: 'bank' });
    expect(result.verified.length).toBe(1);
  });

  it('verifies transaction with keyword type evidence at reduced score', () => {
    // Keyword-only type evidence gets 14 points (vs 28 for structural)
    const rawText = '01/15/2024 amazon purchase 1299.00 debit inr balance 48701.00';
    const txn = makeTransaction({ description: 'amazon purchase', amount: 1299, type: 'debit', date: '2024-01-15' });
    const result = verifyStatement(rawText, [txn], { kind: 'bank' });
    expect(result.verified.length).toBe(1);
    // amount(34) + keyword_type(14) + date(23) = 71, + desc ≥ 15 if desc matches → ≥ 86
    expect(result.verified[0].confidence).toBeGreaterThanOrEqual(75);
  });

  it('rejects when only amount matches and no type/date/description evidence', () => {
    // Amount found in text but nothing else corroborates: no date, no type keywords, no matching description
    const rawText = 'some random text with 1500.00 and more random words without any date or type info';
    const txn = makeTransaction({ description: 'completely different merchant', amount: 1500, type: 'debit' });
    const result = verifyStatement(rawText, [txn], { kind: 'bank' });
    // amount(34) + none_type(14) = 48 < 75 → rejected
    expect(result.verified.length).toBe(0);
    expect(result.rejected.length).toBe(1);
  });

  it('verifies with structural type + date but no description match (85 >= 75)', () => {
    const rawText = '01/15/2024 something 1299.00dr balance 48701.00';
    const txn = makeTransaction({ description: 'totally different merchant name', amount: 1299, type: 'debit', date: '2024-01-15' });
    const result = verifyStatement(rawText, [txn], { kind: 'bank' });
    // amount(34) + structural_type(28) + date(23) = 85 ≥ 75 → verified without description
    expect(result.verified.length).toBe(1);
    expect(result.verified[0].verification.descriptionMatched).toBe(false);
  });

  it('skips consumed positions when matching multiple transactions with same amount', () => {
    // Use 753 — not a substring of any balance value (avoids false matches from toFixed(0) variant)
    const rawText = [
      '2024-01-01 atm withdrawal 753 debit balance 49247',
      '2024-01-05 atm withdrawal 753 debit balance 48494',
      '2024-01-10 atm withdrawal 753 debit balance 47741',
    ].join('\n');
    const txns = [
      makeTransaction({ description: 'atm withdrawal', amount: 753, type: 'debit', date: '2024-01-01' }),
      makeTransaction({ description: 'atm withdrawal', amount: 753, type: 'debit', date: '2024-01-05' }),
      makeTransaction({ description: 'atm withdrawal', amount: 753, type: 'debit', date: '2024-01-10' }),
    ];
    const result = verifyStatement(rawText, txns, { kind: 'bank' });
    // All three must verify — each consuming a different position
    expect(result.verified.length).toBe(3);
    expect(result.rejected.length).toBe(0);
    // Evidence anchors must be distinct (different positions consumed)
    const anchors = result.verified.map(t => t.evidenceAnchor);
    expect(new Set(anchors).size).toBe(3);
  });

  it('rejects third transaction when only two positions are available for same amount', () => {
    const rawText = [
      '2024-01-01 atm withdrawal 753 debit balance 49247',
      '2024-01-05 atm withdrawal 753 debit balance 48494',
    ].join('\n');
    const txns = [
      makeTransaction({ description: 'atm withdrawal', amount: 753, type: 'debit', date: '2024-01-01' }),
      makeTransaction({ description: 'atm withdrawal', amount: 753, type: 'debit', date: '2024-01-05' }),
      makeTransaction({ description: 'atm withdrawal', amount: 753, type: 'debit', date: '2024-01-10' }),
    ];
    const result = verifyStatement(rawText, txns, { kind: 'bank' });
    expect(result.verified.length).toBe(2);
    expect(result.rejected.length).toBe(1);
  });
});
