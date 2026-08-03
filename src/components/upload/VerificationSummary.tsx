'use client';

import { AlertTriangle, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import type { VerificationReport } from '@/lib/verification/verificationEngine';
import type { Currency } from '@/types';
import { formatCurrency } from '@/lib/currencyFormatter';
import { useState } from 'react';
import {
  classifyVerificationReport,
  getVerificationPassed,
} from './verificationSummaryHelpers';

interface VerificationSummaryProps {
  report: VerificationReport;
  currency: Currency;
  // Count of transactions that carry any review reason — the SAME "flagged" definition
  // the rows use (a flag renders when reviewReasons.length > 0). Passed in from the page
  // so the summary's count and the row markers can never disagree. report.rejected alone
  // undercounted: rows also flag for non-rejection reasons (low category confidence,
  // missing fields), and — before rejection was surfaced as a reason — rejected rows
  // flagged nowhere despite being counted here.
  flaggedCount: number;
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
        {/* showSign=true: a computed closing can be legitimately negative (overdraft / wrong
            opening balance). Swallowing the "-"" here hid a ~90k discrepancy as ~8k. */}
        {formatCurrency(extracted, currency, true)} extracted vs {formatCurrency(expected, currency, true)} expected
      </span>
    </div>
  );
}

export function VerificationSummary({ report, currency, flaggedCount }: VerificationSummaryProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const kind = classifyVerificationReport(report);
  const passed = getVerificationPassed(report, kind);

  const ccReport = report.ccAggregate ?? null;

  // Don't show anything if verification passed cleanly and no rows need attention.
  if (passed && flaggedCount === 0) {
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
          {/* CC report details */}
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
                  extracted={ccReport.statementTotals.statementTotalDue}
                  expected={ccReport.statementTotals.computedTotalDue}
                  currency={currency}
                />
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Transaction Match</span>
                <span className={ccReport.transactionSums.passed ? 'text-green-500' : 'text-red-500'}>
                  {ccReport.transactionSums.passed ? '✓' : '✗'}
                </span>
              </div>
              {!ccReport.transactionSums.passed && ccReport.transactionSums.totalDebits !== undefined && ccReport.transactionSums.statementPurchases !== undefined && (
                <MismatchDetail
                  label="Purchases & Charges"
                  extracted={ccReport.transactionSums.statementPurchases}
                  expected={ccReport.transactionSums.totalDebits}
                  currency={currency}
                />
              )}
              {!ccReport.transactionSums.passed && ccReport.transactionSums.totalPayments !== undefined && ccReport.transactionSums.statementPayments !== undefined && (
                <MismatchDetail
                  label="Payments"
                  extracted={ccReport.transactionSums.statementPayments}
                  expected={ccReport.transactionSums.totalPayments}
                  currency={currency}
                />
              )}
              {!ccReport.transactionSums.passed && ccReport.transactionSums.statementFees !== undefined && (
                <MismatchDetail
                  label="Fees & Interest"
                  extracted={ccReport.transactionSums.statementFees}
                  expected={ccReport.transactionSums.totalFees}
                  currency={currency}
                />
              )}
            </>
          )}

          {/* Bank report details */}
          {!ccReport && !report.reconciliation.passed && report.reconciliation.computed !== undefined && report.reconciliation.fromStatement !== undefined && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Reconciliation</span>
                <span className="text-red-500">✗</span>
              </div>
              <MismatchDetail
                label="Closing Balance"
                extracted={report.reconciliation.fromStatement}
                expected={report.reconciliation.computed}
                currency={currency}
              />
            </>
          )}

          {flaggedCount > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Flagged Transactions</span>
              <span className="text-red-500">{flaggedCount}</span>
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
