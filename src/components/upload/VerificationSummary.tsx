'use client';

import { Badge } from '@/components/ui/badge';
import { AlertTriangle, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import type { VerificationReport, CCVerificationReport } from '@/lib/verification/verificationEngine';
import type { Currency } from '@/types';
import { formatCurrency } from '@/lib/currencyFormatter';
import { useState } from 'react';

interface VerificationSummaryProps {
  report: VerificationReport | CCVerificationReport;
  currency: Currency;
}

function MismatchDetail({ label, extracted, expected, currency }: {
  label: string;
  extracted: number;
  expected: number;
  currency: Currency;
}) {
  return (
    <div className="flex items-center justify-between text-xs pl-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-red-400">
        {formatCurrency(extracted, currency, false)} extracted vs {formatCurrency(expected, currency, false)} expected
      </span>
    </div>
  );
}

export function VerificationSummary({ report, currency }: VerificationSummaryProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Type guard: CCVerificationReport has 'passed' field
  const isCCReport = 'passed' in report && 'statementTotals' in report;
  const isBankReport = !isCCReport;

  const passed = isCCReport ? report.passed : report.reconciliation.passed;
  const confidence = report.overallConfidence;
  const rejected = isBankReport ? report.rejected : [];

  const ccReport = isCCReport ? report : null;

  // Don't show anything if verification passed with high confidence
  if (passed && confidence >= 80) {
    return null;
  }

  return (
    <div className="w-[80vw] mx-auto mt-4 border rounded-lg bg-muted/30">
      {/* Clickable Header */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          {passed ? (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          ) : (
            <XCircle className="h-4 w-4 text-red-500" />
          )}
          <span className="font-medium text-sm">
            Verification {passed ? 'Warnings' : 'Failed'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={confidence >= 80 ? 'default' : confidence >= 50 ? 'secondary' : 'destructive'}>
            {confidence}%
          </Badge>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </div>
      </div>

      {/* Expandable Content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-2 text-sm border-t pt-3">
          {ccReport && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Balance Match</span>
                <span className={ccReport.statementTotals.passed ? 'text-green-500' : 'text-red-500'}>
                  {ccReport.statementTotals.passed ? '✓' : '✗'}
                </span>
              </div>
              {!ccReport.statementTotals.passed && (
                <MismatchDetail
                  label="Total Due"
                  extracted={ccReport.statementTotals.computedTotalDue}
                  expected={ccReport.statementTotals.expectedTotalDue}
                  currency={currency}
                />
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Transaction Match</span>
                <span className={ccReport.transactionSums.passed ? 'text-green-500' : 'text-red-500'}>
                  {ccReport.transactionSums.passed ? '✓' : '✗'}
                </span>
              </div>
              {!ccReport.transactionSums.passed && ccReport.transactionSums.statementPurchases !== undefined && (
                <MismatchDetail
                  label="Purchases"
                  extracted={ccReport.transactionSums.totalPurchases}
                  expected={ccReport.transactionSums.statementPurchases}
                  currency={currency}
                />
              )}
              {!ccReport.transactionSums.passed && ccReport.transactionSums.statementPayments !== undefined && (
                <MismatchDetail
                  label="Payments"
                  extracted={ccReport.transactionSums.totalPayments}
                  expected={ccReport.transactionSums.statementPayments}
                  currency={currency}
                />
              )}
            </>
          )}

          {rejected.length > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Flagged Transactions</span>
              <span className="text-red-500">{rejected.length}</span>
            </div>
          )}

          <p className="text-xs text-muted-foreground pt-2">
            {passed
              ? 'Some transactions may need review. Please verify amounts before importing.'
              : 'Balance reconciliation failed. Please review transactions carefully or re-upload the statement.'}
          </p>
        </div>
      )}
    </div>
  );
}
