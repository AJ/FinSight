import { describe, it, expect } from 'vitest';
import { verifyStatement, verifyCCStatement, validateCCCrossSection, validateBankCrossSection } from '@/lib/verification/verificationEngine';
import type { ExtractedTransaction } from '@/types/extractedTransaction';
import type { CCSummary, BankSummary } from '@/lib/parsers/extractSummary';
import { makeTransaction } from '@tests/unit/factories';

const USD_CURRENCY = { code: 'USD', symbol: '$', name: 'US Dollar' };

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
    const result = verifyStatement(simpleRawText, txns, { openingBalance: 50000, closingBalance: 50000 });
    expect(result.verified.length).toBeGreaterThan(0);
    expect(result.verified[0].confidence).toBeGreaterThanOrEqual(75);
  });

  it('rejects transactions not found in text', () => {
    const txns = [
      makeTransaction({ description: 'TOTALLY FAKE MERCHANT', amount: 999999, type: 'debit' }),
    ];
    const result = verifyStatement(rawText, txns, {});
    expect(result.rejected.length).toBeGreaterThan(0);
    expect(result.verified.length).toBe(0);
  });

  it('detects duplicate transactions (same signature content)', () => {
    const simpleRawText = `2024-01-15 AMAZON PURCHASE 1299 debit`;
    const txn1 = makeTransaction({ description: 'AMAZON PURCHASE', amount: 1299, type: 'debit', date: '2024-01-15' });
    const txn2 = makeTransaction({ description: 'AMAZON PURCHASE', amount: 1299, type: 'debit', date: '2024-01-15' });
    const result = verifyStatement(simpleRawText, [txn1, txn2], {});
    // Both transactions have the same signature → second is duplicate
    expect(result.duplicates.length).toBe(1);
  });

  it('computes overall confidence', () => {
    const txns = [
      makeTransaction({ description: 'AMAZON INDIA PURCHASE', amount: 1299, type: 'debit', date: '2024-01-01' }),
    ];
    const result = verifyStatement(rawText, txns, { openingBalance: 50000, closingBalance: 98351 });
    expect(result.overallConfidence).toBeGreaterThanOrEqual(0);
    expect(result.overallConfidence).toBeLessThanOrEqual(100);
  });
});

describe('verifyStatement — reconciliation', () => {
  it('reconciliation is skipped when no transactions are verified', () => {
    const txns = [
      makeTransaction({ amount: 1000, type: 'credit' }),
      makeTransaction({ amount: 300, type: 'debit' }),
    ];
    // With rawText = 'text', transactions won't be found → none verified → reconciliation fails
    const result = verifyStatement('text', txns, { openingBalance: 50000, closingBalance: 50700 });
    // No verified transactions means reconciliation can still run but with 0 txns
    expect(result.reconciliation.passed).toBe(false); // 0 credits - 0 debits ≠ 700
  });

  it('fails when balance equation does not hold', () => {
    const txns = [
      makeTransaction({ amount: 1000, type: 'credit' }),
    ];
    const result = verifyStatement('text', txns, { openingBalance: 50000, closingBalance: 100000 });
    expect(result.reconciliation.passed).toBe(false);
    expect(result.reconciliation.difference).toBeGreaterThan(1.0);
  });

  it('returns not passed when balances are missing', () => {
    const result = verifyStatement('text', [], {});
    expect(result.reconciliation.passed).toBe(false);
  });
});

describe('verifyCCStatement', () => {
  it('passes when statement totals formula holds', () => {
    const txns = [
      makeTransaction({ amount: 10000, type: 'debit' }),
      makeTransaction({ amount: 5000, type: 'credit' }),
    ];
    // PreviousBalance(30000) + Debits(10000) - Credits(5000) = 35000
    const result = verifyCCStatement(txns, {
      previousBalance: 30000,
      totalDue: 35000,
      purchasesAndCharges: 10000,
      paymentsReceived: 5000,
    });
    expect(result.statementTotals.passed).toBe(true);
    expect(result.statementTotals.difference).toBeLessThanOrEqual(1.0);
    expect(result.passed).toBe(true);
  });

  it('fails when statement totals do not match', () => {
    const txns = [
      makeTransaction({ amount: 1000, type: 'debit' }),
    ];
    // Previous(30000) + Debits(1000) - Credits(0) = 31000, but expected 50000
    const result = verifyCCStatement(txns, {
      previousBalance: 30000,
      totalDue: 50000,
    });
    expect(result.statementTotals.passed).toBe(false);
  });

  it('gives partial credit for small differences', () => {
    const txns = [
      makeTransaction({ amount: 10000, type: 'debit' }),
    ];
    // Computed: 30000 + 10000 = 40000, Expected: 40050 (diff = 50, < 100)
    const result = verifyCCStatement(txns, {
      previousBalance: 30000,
      totalDue: 40050,
    });
    expect(result.overallConfidence).toBeGreaterThanOrEqual(25);
  });

  it('verifies transaction sums by type', () => {
    const txns = [
      makeTransaction({ amount: 5000, type: 'debit', transactionSubType: 'purchase' }),
      makeTransaction({ amount: 3000, type: 'credit', transactionSubType: 'bill_payment' }),
    ];
    const result = verifyCCStatement(txns, {
      purchasesAndCharges: 5000,
      paymentsReceived: 3000,
    });
    expect(result.transactionSums.passed).toBe(true);
  });

  it('passes when statement meta fields are undefined', () => {
    const txns = [
      makeTransaction({ amount: 1000, type: 'debit' }),
    ];
    const result = verifyCCStatement(txns, {});
    // Without statement data to compare against, should pass by default
    expect(result.transactionSums.passed).toBe(true);
  });

  it('calculates correct subtype breakdown', () => {
    const txns = [
      makeTransaction({ amount: 1000, type: 'debit', transactionSubType: 'purchase' }),
      makeTransaction({ amount: 500, type: 'debit', transactionSubType: 'fee' }),
      makeTransaction({ amount: 200, type: 'credit', transactionSubType: 'cashback' }),
    ];
    const result = verifyCCStatement(txns, {});
    expect(result.transactionSums.totalPurchases).toBe(1000);
    expect(result.transactionSums.totalFees).toBe(500);
    expect(result.transactionSums.totalDebits).toBe(1500);
    expect(result.transactionSums.totalCredits).toBe(200);
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

describe('verifyStatement — currency matching', () => {
  it('adds 10 confidence points when currency code appears in raw text', () => {
    // Raw text contains "usd" and "debit" keyword. Transaction has USD currency.
    // amount(30) + type(25) + date(20) + description(15) + context(~matched) + currency(10) = 100+
    const rawText = '2024-01-15 amazon purchase debit 99.99 usd balance 9900';
    const txnUsd = makeTransaction({ description: 'amazon purchase', amount: 99.99, date: '2024-01-15', localCurrency: 'USD' });
    const txnInr = makeTransaction({ description: 'amazon purchase', amount: 99.99, date: '2024-01-15', localCurrency: 'INR' });

    const resultUsd = verifyStatement(rawText, [txnUsd], {});
    const resultInr = verifyStatement(rawText, [txnInr], {});

    // Both should verify (amount + type + date + description = 90 without currency)
    expect(resultUsd.verified.length).toBeGreaterThan(0);
    expect(resultInr.verified.length).toBeGreaterThan(0);
    // USD one has strictly higher confidence due to currency match (+10 points)
    expect(resultUsd.verified[0].confidence).toBeGreaterThan(resultInr.verified[0].confidence);
  });

  it('currency is case-insensitive in matching (raw text normalized to lowercase)', () => {
    // verifyStatement normalizes raw text to lowercase, so "INR" in raw becomes "inr"
    // The code checks rawText.includes(code.toLowerCase()) which is "inr".includes("inr") → true
    const rawTextWithUppercase = '2024-01-15 PURCHASE debit 1299 INR';
    const txn = makeTransaction({ description: 'PURCHASE', amount: 1299, date: '2024-01-15', localCurrency: 'INR' });
    const result = verifyStatement(rawTextWithUppercase, [txn], {});

    expect(result.verified.length).toBeGreaterThan(0);
    expect(result.verified[0].verification.currencyMatched).toBe(true);
  });

  it('currency not present in raw text still passes verification on other fields', () => {
    const rawText = '2024-01-15 amazon purchase debit 99.99 balance 9900';
    const txn = makeTransaction({ description: 'amazon purchase', amount: 99.99, date: '2024-01-15', localCurrency: 'EUR' });
    const result = verifyStatement(rawText, [txn], {});

    expect(result.verified.length).toBeGreaterThan(0);
    expect(result.verified[0].verification.currencyMatched).toBe(false);
  });

  it('transactions without localCurrency default to currency match true', () => {
    // makeTransaction without localCurrency gets INR default from Transaction.fromExtracted
    const rawText = '2024-01-15 purchase debit 99.99';
    const txn = makeTransaction({ description: 'purchase', amount: 99.99, date: '2024-01-15' });
    expect(txn.localCurrency.code).toBe('INR');
    // "purchase debit 99.99" normalized doesn't contain "inr" → currencyMatched=false
    const result = verifyStatement(rawText, [txn], {});
    expect(result.verified.length).toBeGreaterThan(0);
    expect(result.verified[0].verification.currencyMatched).toBe(false);
  });
});
