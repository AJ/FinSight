import type { VerificationReport } from '@/lib/verification/verificationEngine';

export function classifyVerificationReport(
  report: VerificationReport,
): 'bank' | 'credit_card' {
  return report.ccAggregate !== undefined ? 'credit_card' : 'bank';
}

export function getVerificationPassed(
  report: VerificationReport,
  kind: 'bank' | 'credit_card',
): boolean {
  if (kind === 'credit_card') {
    return report.ccAggregate
      ? report.ccAggregate.statementTotals.passed && report.ccAggregate.transactionSums.passed
      : report.reconciliation.passed;
  }
  return report.reconciliation.passed;
}
