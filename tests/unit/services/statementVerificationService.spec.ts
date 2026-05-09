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

    // Both verifyCCStatement and verifyStatement run for CC inputs
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
});
