import type { VerificationReport, CCVerificationReport } from '@/lib/verification/verificationEngine';

export type AnyVerificationReport = VerificationReport | CCVerificationReport;

export function classifyVerificationReport(
  report: AnyVerificationReport,
): 'bank' | 'credit_card' {
  // CCVerificationReport has a top-level `passed` boolean;
  // VerificationReport has `reconciliation.passed` instead.
  return 'passed' in report && 'statementTotals' in report
    ? 'credit_card'
    : 'bank';
}

export function getVerificationPassed(
  report: AnyVerificationReport,
  kind: 'bank' | 'credit_card',
): boolean {
  return kind === 'credit_card'
    ? (report as CCVerificationReport).passed
    : (report as VerificationReport).reconciliation.passed;
}

export function getConfidenceBadgeVariant(confidence: number): 'default' | 'secondary' | 'destructive' {
  if (confidence >= 80) return 'default';
  if (confidence >= 50) return 'secondary';
  return 'destructive';
}

export const HIGH_CONFIDENCE_THRESHOLD = 80;
