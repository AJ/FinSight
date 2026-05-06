import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  verifyStatement,
  verifyCCStatement,
} from '@/lib/verification/verificationEngine';

vi.mock('@/lib/verification/verificationEngine', () => ({
  verifyStatement: vi.fn(),
  verifyCCStatement: vi.fn(),
}));

import { attachVerificationToExtractionBundle } from '@/lib/services/statementVerificationService';
import type { ExtractionBundle } from '@/lib/parsers/contracts';
import { makeTransaction } from '@tests/unit/factories';

function makeBundle(overrides: Partial<ExtractionBundle> = {}): ExtractionBundle {
  return {
    transactions: [makeTransaction()],
    warnings: ['existing warning'],
    verificationInputs: null,
    summary: null,
    ...overrides,
  } as ExtractionBundle;
}

describe('attachVerificationToExtractionBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns bundle unchanged when verificationInputs is null', () => {
    const bundle = makeBundle({ verificationInputs: null });
    const result = attachVerificationToExtractionBundle(bundle);

    expect(verifyStatement).not.toHaveBeenCalled();
    expect(result).toEqual(bundle);
  });

  it('runs bank verification and merges confidence', () => {
    const txn = makeTransaction();
    const bundle = makeBundle({
      verificationInputs: {
        kind: 'bank',
        rawText: 'statement text',
        transactions: [txn],
        meta: { openingBalance: 0, closingBalance: 1000, currency: 'INR' },
      },
    });

    vi.mocked(verifyStatement).mockReturnValue({
      verified: [{ id: txn.id, confidence: 0.95 }],
      reconciliation: { passed: true, difference: 0 },
    } as any);

    const result = attachVerificationToExtractionBundle(bundle);

    expect(verifyStatement).toHaveBeenCalledOnce();
    expect(result.verificationReport).toBeDefined();
    expect(result.warnings).toContain('existing warning');
  });

  it('adds warning when bank reconciliation fails', () => {
    const bundle = makeBundle({
      verificationInputs: {
        kind: 'bank',
        rawText: 'text',
        transactions: [makeTransaction()],
        meta: { openingBalance: 0, closingBalance: 1000, currency: 'INR' },
      },
    });

    vi.mocked(verifyStatement).mockReturnValue({
      verified: [],
      reconciliation: { passed: false, difference: 50.25 },
    } as any);

    const result = attachVerificationToExtractionBundle(bundle);
    expect(result.warnings).toContain('existing warning');
    expect(result.warnings.some((w) => w.includes('reconciliation difference'))).toBe(true);
  });

  it('does not add warning when bank reconciliation passes', () => {
    const bundle = makeBundle({
      verificationInputs: {
        kind: 'bank',
        rawText: 'text',
        transactions: [makeTransaction()],
        meta: { openingBalance: 0, closingBalance: 1000, currency: 'INR' },
      },
    });

    vi.mocked(verifyStatement).mockReturnValue({
      verified: [],
      reconciliation: { passed: true, difference: 0 },
    } as any);

    const result = attachVerificationToExtractionBundle(bundle);
    expect(result.warnings).toHaveLength(1); // only the existing warning
  });

  it('runs both CC verifiers for credit card inputs', () => {
    const bundle = makeBundle({
      verificationInputs: {
        kind: 'credit_card',
        rawText: 'cc text',
        transactions: [makeTransaction()],
        meta: {
          previousBalance: 5000,
          totalDue: 10000,
          currency: 'INR',
          minimumDue: 500,
          creditLimit: 100000,
        } as any,
      },
    });

    vi.mocked(verifyCCStatement).mockReturnValue({ passed: true } as any);
    vi.mocked(verifyStatement).mockReturnValue({
      verified: [],
      reconciliation: { passed: true, difference: 0 },
    } as any);

    const result = attachVerificationToExtractionBundle(bundle);
    expect(verifyCCStatement).toHaveBeenCalledOnce();
    expect(verifyStatement).toHaveBeenCalledOnce();
  });

  it('adds warning when CC verification fails', () => {
    const bundle = makeBundle({
      verificationInputs: {
        kind: 'credit_card',
        rawText: 'text',
        transactions: [makeTransaction()],
        meta: {
          previousBalance: 5000,
          totalDue: 10000,
          currency: 'INR',
          minimumDue: 500,
          creditLimit: 100000,
        } as any,
      },
    });

    vi.mocked(verifyCCStatement).mockReturnValue({ passed: false } as any);
    vi.mocked(verifyStatement).mockReturnValue({
      verified: [],
      reconciliation: { passed: true, difference: 0 },
    } as any);

    const result = attachVerificationToExtractionBundle(bundle);
    expect(result.warnings.some((w) => w.includes('Credit card'))).toBe(true);
  });

  it('preserves unmatched transaction confidence as undefined', () => {
    const txn = makeTransaction({ id: 'unmatched' });
    const bundle = makeBundle({
      verificationInputs: {
        kind: 'bank',
        rawText: 'text',
        transactions: [txn],
        meta: { openingBalance: 0, closingBalance: 1000, currency: 'INR' },
      },
    });

    vi.mocked(verifyStatement).mockReturnValue({
      verified: [], // no match for this transaction
      reconciliation: { passed: true, difference: 0 },
    } as any);

    const result = attachVerificationToExtractionBundle(bundle);
    expect(result.transactions[0].verificationConfidence).toBeUndefined();
  });
});
