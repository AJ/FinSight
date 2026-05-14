import { describe, it, expect } from 'vitest';
import {
  classifyVerificationReport,
  getVerificationPassed,
  getConfidenceBadgeVariant,
  HIGH_CONFIDENCE_THRESHOLD,
} from '@/components/upload/verificationSummaryHelpers';
import type { VerificationReport, CCVerificationReport } from '@/lib/verification/verificationEngine';

function makeBankReport(overrides: Partial<VerificationReport> = {}): VerificationReport {
  return {
    verified: [],
    rejected: [],
    duplicates: [],
    reconciliation: { passed: false },
    overallConfidence: 50,
    ...overrides,
  };
}

function makeCCReport(overrides: Partial<CCVerificationReport> = {}): CCVerificationReport {
  return {
    statementTotals: {
      passed: false,
      expectedTotalDue: 1000,
      computedTotalDue: 900,
      difference: 100,
      formula: '',
    },
    transactionSums: {
      passed: false,
      totalPurchases: 800,
      totalPayments: 200,
      totalFees: 50,
    },
    overallConfidence: 50,
    passed: false,
    ...overrides,
  };
}

describe('classifyVerificationReport', () => {
  it('identifies bank reports', () => {
    expect(classifyVerificationReport(makeBankReport())).toBe('bank');
  });

  it('identifies CC reports', () => {
    expect(classifyVerificationReport(makeCCReport())).toBe('credit_card');
  });

  it('identifies bank report with high confidence', () => {
    expect(classifyVerificationReport(makeBankReport({ overallConfidence: 95 }))).toBe('bank');
  });

  it('identifies CC report with high confidence', () => {
    expect(classifyVerificationReport(makeCCReport({ overallConfidence: 95 }))).toBe('credit_card');
  });
});

describe('getVerificationPassed', () => {
  it('reads reconciliation.passed for bank reports', () => {
    expect(getVerificationPassed(makeBankReport({ reconciliation: { passed: true } }), 'bank')).toBe(true);
    expect(getVerificationPassed(makeBankReport({ reconciliation: { passed: false } }), 'bank')).toBe(false);
  });

  it('reads top-level passed for CC reports', () => {
    expect(getVerificationPassed(makeCCReport({ passed: true }), 'credit_card')).toBe(true);
    expect(getVerificationPassed(makeCCReport({ passed: false }), 'credit_card')).toBe(false);
  });
});

describe('getConfidenceBadgeVariant', () => {
  it('returns default for >= 80', () => {
    expect(getConfidenceBadgeVariant(80)).toBe('default');
    expect(getConfidenceBadgeVariant(100)).toBe('default');
  });

  it('returns secondary for >= 50', () => {
    expect(getConfidenceBadgeVariant(50)).toBe('secondary');
    expect(getConfidenceBadgeVariant(79)).toBe('secondary');
  });

  it('returns destructive for < 50', () => {
    expect(getConfidenceBadgeVariant(49)).toBe('destructive');
    expect(getConfidenceBadgeVariant(0)).toBe('destructive');
  });
});

describe('HIGH_CONFIDENCE_THRESHOLD', () => {
  it('is 80', () => {
    expect(HIGH_CONFIDENCE_THRESHOLD).toBe(80);
  });
});
