import { describe, it, expect } from 'vitest';
import {
  classifyVerificationReport,
  getVerificationPassed,
} from '@/components/upload/verificationSummaryHelpers';
import type { VerificationReport } from '@/lib/verification/verificationEngine';

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

function makeCCReport(overrides: Partial<VerificationReport> = {}): VerificationReport {
  return {
    verified: [],
    rejected: [],
    duplicates: [],
    reconciliation: { passed: false },
    ccAggregate: {
      statementTotals: {
        passed: false,
        statementTotalDue: 1000,
        computedTotalDue: 900,
      },
      transactionSums: {
        passed: false,
        totalDebits: 800,
        totalCredits: 200,
        totalFees: 50,
      },
    },
    overallConfidence: 50,
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

  it('reads ccAggregate for CC reports', () => {
    expect(getVerificationPassed(makeCCReport({
      ccAggregate: {
        statementTotals: { passed: true, statementTotalDue: 1000, computedTotalDue: 1000 },
        transactionSums: { passed: true, totalDebits: 100, totalCredits: 0, totalFees: 0 },
      },
    }), 'credit_card')).toBe(true);
    expect(getVerificationPassed(makeCCReport({
      ccAggregate: {
        statementTotals: { passed: false, statementTotalDue: 1000, computedTotalDue: 900 },
        transactionSums: { passed: true, totalDebits: 100, totalCredits: 0, totalFees: 0 },
      },
    }), 'credit_card')).toBe(false);
  });

  it('falls back to reconciliation for CC reports without ccAggregate', () => {
    expect(getVerificationPassed(makeBankReport({ reconciliation: { passed: true } }), 'credit_card')).toBe(true);
    expect(getVerificationPassed(makeBankReport({ reconciliation: { passed: false } }), 'credit_card')).toBe(false);
  });
});
