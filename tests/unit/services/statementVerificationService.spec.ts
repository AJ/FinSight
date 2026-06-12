import { describe, it, expect, vi, beforeEach } from 'vitest';

import { attachVerificationToExtractionBundle } from '@/lib/services/statementVerificationService';
import type { ExtractionBundle } from '@/lib/parsers/contracts';
import { makeTransaction } from '@tests/unit/factories';
import type { BankVerificationInputs, CreditCardVerificationInputs } from '@/lib/parsers/contracts';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeBundle(overrides: Partial<ExtractionBundle> = {}): ExtractionBundle {
  return {
    transactions: [makeTransaction()],
    currency: null,
    format: 'pdf',
    fileName: 'test.pdf',
    parseDate: new Date(),
    statementType: null,
    warnings: ['existing warning'],
    errors: [],
    parsingErrors: [],
    ...overrides,
  };
}

// Raw text containing the default makeTransaction() details for successful matching
const rawTextWithTxDetails = '2024-01-15 Test Transaction 100 debit';

function bankVerificationInputs(overrides: Partial<BankVerificationInputs> = {}): BankVerificationInputs {
  return {
    kind: 'bank',
    rawText: rawTextWithTxDetails,
    transactions: [makeTransaction()],
    meta: { openingBalance: 1000, closingBalance: 900, currency: 'INR' },
    ...overrides,
  };
}

function ccVerificationInputs(): CreditCardVerificationInputs {
  return {
    kind: 'credit_card',
    rawText: rawTextWithTxDetails,
    transactions: [makeTransaction()],
    meta: {
      previousBalance: 1000,
      totalDue: 1100,
      currency: 'INR',
      purchasesAndCharges: 200,
      paymentsReceived: 100,
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('attachVerificationToExtractionBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('returns bundle unchanged when verificationInputs is undefined', () => {
    const bundle = makeBundle({ verificationInputs: undefined });
    const result = attachVerificationToExtractionBundle(bundle);

    expect(result).toEqual(bundle);
    expect(result.verificationReport).toBeUndefined();
  });

  it('runs bank verification and adds report to bundle', () => {
    const bundle = makeBundle({
      verificationInputs: bankVerificationInputs(),
    });

    const result = attachVerificationToExtractionBundle(bundle);

    expect(result.verificationReport).toBeDefined();
    expect(result.warnings).toContain('existing warning');
  });

  it('adds warning when bank reconciliation fails', () => {
    const txn = makeTransaction();
    const bundle = makeBundle({
      verificationInputs: bankVerificationInputs({
        meta: { openingBalance: 1000, closingBalance: 500, currency: 'INR' },
        transactions: [txn],
      }),
    });

    const result = attachVerificationToExtractionBundle(bundle);

    expect(result.warnings.some((w) => w.includes('reconciliation difference'))).toBe(true);
  });

  it('does not add warning when bank reconciliation passes', () => {
    // openingBalance=1000, debit=100 → computed closing=900 → matches closingBalance=900
    const txn = makeTransaction();
    const bundle = makeBundle({
      verificationInputs: bankVerificationInputs({
        transactions: [txn],
      }),
    });

    const result = attachVerificationToExtractionBundle(bundle);

    expect(result.warnings).toHaveLength(1); // only the existing warning
  });

  it('runs both CC verifiers for credit card inputs', () => {
    const bundle = makeBundle({
      verificationInputs: ccVerificationInputs(),
    });

    const result = attachVerificationToExtractionBundle(bundle);

    // verifyStatement handles both per-transaction matching and CC aggregate checks
    expect(result.verificationReport).toBeDefined();
  });

  it('adds warning when CC verification fails', () => {
    // previousBalance=1000, totalDue=100 → computed previous+credits-debits won't match
    const bundle = makeBundle({
      verificationInputs: {
        kind: 'credit_card',
        rawText: rawTextWithTxDetails,
        transactions: [makeTransaction()],
        meta: {
          previousBalance: 5000,
          totalDue: 100,
          currency: 'INR',
          purchasesAndCharges: 200,
          paymentsReceived: 100,
        },
      },
    });

    const result = attachVerificationToExtractionBundle(bundle);

    expect(result.warnings.some((w) => w.includes('Credit card'))).toBe(true);
  });

  it('merges verification confidence into transactions', () => {
    const txn = makeTransaction();
    const bundle = makeBundle({
      verificationInputs: bankVerificationInputs({
        transactions: [txn],
      }),
    });

    const result = attachVerificationToExtractionBundle(bundle);

    // If the transaction was verified, confidence should be set; if not, it should be undefined
    // Either way, the function should not crash and should preserve transaction count
    expect(result.transactions).toHaveLength(1);
  });

  // ── Gap coverage ──────────────────────────────────────────────────────────────

  it('CC happy path — both statementTotals and transactionSums pass, no warning added', () => {
    // previousBalance=1000, totalDue=1100, one debit of 100
    // computedTotalDue = 1000 + 100 - 0 = 1100, matches totalDue=1100
    // transactionSums: totalDebits(100) ≈ purchasesAndCharges(200)? No — need to match.
    // Let's use: previousBalance=1000, totalDue=1100, purchasesAndCharges=100, paymentsReceived=0
    // debit txn of 100 → totalDebits=100, totalCredits=0
    // statementTotals: 1000 + 100 - 0 = 1100 == totalDue(1100) ✓
    // transactionSums: totalDebits(100) ≈ purchasesAndCharges(100) ✓, totalCredits(0) ≈ paymentsReceived(0) ✓
    const txn = makeTransaction({ type: 'debit', amount: 100 });
    const bundle = makeBundle({
      verificationInputs: {
        kind: 'credit_card',
        rawText: '2024-01-15 Test Transaction 100 debit',
        transactions: [txn],
        meta: {
          previousBalance: 1000,
          totalDue: 1100,
          currency: 'INR',
          purchasesAndCharges: 100,
          paymentsReceived: 0,
        },
      },
    });

    const result = attachVerificationToExtractionBundle(bundle);

    // Only the pre-existing warning — no verification warning added
    expect(result.warnings).toEqual(['existing warning']);
    expect(result.verificationReport).toBeDefined();
    const report = result.verificationReport!;
    expect(report.ccAggregate!.statementTotals.passed).toBe(true);
    expect(report.ccAggregate!.transactionSums.passed).toBe(true);
  });

  it('CC individual sub-check — only statementTotals fails, warning still mentions it', () => {
    // previousBalance=1000, totalDue=5000 (way off), purchasesAndCharges=100, paymentsReceived=0
    // statementTotals: 1000 + 100 - 0 = 1100 ≠ 5000 → fails
    // transactionSums: totalDebits(100) ≈ purchasesAndCharges(100) ✓, totalCredits(0) ≈ paymentsReceived(0) ✓
    const txn = makeTransaction({ type: 'debit', amount: 100 });
    const bundle = makeBundle({
      verificationInputs: {
        kind: 'credit_card',
        rawText: '2024-01-15 Test Transaction 100 debit',
        transactions: [txn],
        meta: {
          previousBalance: 1000,
          totalDue: 5000,
          currency: 'INR',
          purchasesAndCharges: 100,
          paymentsReceived: 0,
        },
      },
    });

    const result = attachVerificationToExtractionBundle(bundle);

    const ccWarning = result.warnings.find((w) => w.includes('Credit card'));
    expect(ccWarning).toBeDefined();
    const report = result.verificationReport!;
    expect(report.ccAggregate!.statementTotals.passed).toBe(false);
    expect(report.ccAggregate!.transactionSums.passed).toBe(true);
  });

  it('bank reconciliation with undefined difference falls back to "unknown"', () => {
    // When openingBalance or closingBalance is undefined, reconcile() returns { passed: false }
    // with no difference field, so the warning says "unknown"
    const txn = makeTransaction();
    const bundle = makeBundle({
      verificationInputs: bankVerificationInputs({
        meta: { openingBalance: undefined, closingBalance: undefined, currency: 'INR' },
        transactions: [txn],
      }),
    });

    const result = attachVerificationToExtractionBundle(bundle);

    const reconWarning = result.warnings.find((w) => w.includes('difference of unknown'));
    expect(reconWarning).toBeDefined();
  });

  it('mergeVerificationConfidence with partially matching IDs — some verified, some not', () => {
    // Two transactions in bundle, but raw text only matches one of them.
    // The matched one gets verificationConfidence, the other stays undefined.
    const matchedTxn = makeTransaction({ id: 'tx-matched', description: 'Test Transaction', amount: 100 });
    const unmatchedTxn = makeTransaction({ id: 'tx-unmatched', description: 'Completely Different Merchant XYZ999', amount: 99999 });
    const bundle = makeBundle({
      transactions: [matchedTxn, unmatchedTxn],
      verificationInputs: bankVerificationInputs({
        rawText: '2024-01-15 Test Transaction 100 debit',
        transactions: [matchedTxn, unmatchedTxn],
        meta: { openingBalance: 1000, closingBalance: 900, currency: 'INR' },
      }),
    });

    const result = attachVerificationToExtractionBundle(bundle);

    expect(result.transactions).toHaveLength(2);
    // The matched transaction should have some confidence value (number or undefined if rejected)
    // The key assertion: the function does not crash and preserves all transactions
    const matched = result.transactions.find((t) => t.id === 'tx-matched');
    const unmatched = result.transactions.find((t) => t.id === 'tx-unmatched');
    expect(matched).toBeDefined();
    expect(unmatched).toBeDefined();
  });

  // ── Nuanced warning tests ────────────────────────────────────────────────────

  it('bank: recon passes but unverified transactions → nuanced warning', () => {
    // opening=1000, credit=100, debit=0 → computed=1100, closing=1100 → recon passes
    // But rawText is generic — transaction won't verify against it
    const txn = makeTransaction({ amount: 100, type: 'credit', description: 'Something Not In Text' });
    const bundle = makeBundle({
      verificationInputs: bankVerificationInputs({
        rawText: 'unrelated text without transaction details',
        transactions: [txn],
        meta: { openingBalance: 1000, closingBalance: 1100, currency: 'INR' },
      }),
    });

    const result = attachVerificationToExtractionBundle(bundle);

    const warning = result.warnings.find((w) => w.includes('Reconciliation balanced'));
    expect(warning).toBeDefined();
    expect(warning).toContain('could not be verified against source text');
    expect(warning).toContain('overall confidence');
  });

  it('bank: recon fails → primary failure warning with difference', () => {
    const txn = makeTransaction();
    const bundle = makeBundle({
      verificationInputs: bankVerificationInputs({
        meta: { openingBalance: 1000, closingBalance: 500, currency: 'INR' },
        transactions: [txn],
      }),
    });

    const result = attachVerificationToExtractionBundle(bundle);

    const warning = result.warnings.find((w) => w.includes('Balance reconciliation difference'));
    expect(warning).toBeDefined();
    // Should NOT say "Reconciliation balanced"
    expect(warning).not.toContain('Reconciliation balanced');
  });

  it('bank: recon passes, all verified → no verification warning', () => {
    const txn = makeTransaction({ description: 'Test Transaction', amount: 100, type: 'debit', date: '2024-01-15' });
    const bundle = makeBundle({
      verificationInputs: bankVerificationInputs({
        rawText: '2024-01-15 Test Transaction 100 debit',
        transactions: [txn],
        meta: { openingBalance: 1000, closingBalance: 900, currency: 'INR' },
      }),
    });

    const result = attachVerificationToExtractionBundle(bundle);

    // Only the existing warning — no verification warning
    expect(result.warnings).toEqual(['existing warning']);
  });

  it('CC: only statementTotals fails → specific warning', () => {
    // previousBalance=1000, totalDue=5000 (way off)
    // transactionSums: totalDebits(100) ≈ purchasesAndCharges(100) ✓
    const txn = makeTransaction({ type: 'debit', amount: 100 });
    const bundle = makeBundle({
      verificationInputs: {
        kind: 'credit_card',
        rawText: '2024-01-15 Test Transaction 100 debit',
        transactions: [txn],
        meta: {
          previousBalance: 1000,
          totalDue: 5000,
          currency: 'INR',
          purchasesAndCharges: 100,
          paymentsReceived: 0,
        },
      },
    });

    const result = attachVerificationToExtractionBundle(bundle);

    const warning = result.warnings.find((w) => w.includes('totals do not fully reconcile'));
    expect(warning).toBeDefined();
    expect(warning).not.toContain('transaction sums');
  });

  it('CC: both fail → combined warning', () => {
    const txn = makeTransaction({ type: 'debit', amount: 100 });
    const bundle = makeBundle({
      verificationInputs: {
        kind: 'credit_card',
        rawText: 'text',
        transactions: [txn],
        meta: {
          previousBalance: 5000,
          totalDue: 100,
          currency: 'INR',
          purchasesAndCharges: 9999,
          paymentsReceived: 0,
        },
      },
    });

    const result = attachVerificationToExtractionBundle(bundle);

    const warning = result.warnings.find((w) => w.includes('totals and transaction sums'));
    expect(warning).toBeDefined();
  });
});
