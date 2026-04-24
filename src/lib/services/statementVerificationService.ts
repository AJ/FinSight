import { Transaction } from "@/types";
import type {
  CCVerificationReport,
  VerificationReport,
} from "@/lib/verification/verificationEngine";
import {
  verifyCCStatement,
  verifyStatement,
} from "@/lib/verification/verificationEngine";
import type {
  ExtractionBundle,
  VerificationInputs,
} from "@/lib/parsers/contracts";

function mergeVerificationConfidence(
  transactions: Transaction[],
  report: VerificationReport,
): Transaction[] {
  const verifiedMap = new Map(
    report.verified.map((transaction) => [transaction.id, transaction.confidence]),
  );

  return transactions.map((transaction) =>
    Transaction.fromJSON({
      ...transaction.toJSON(),
      verificationConfidence: verifiedMap.get(transaction.id),
    }),
  );
}

function buildVerificationWarning(
  inputs: VerificationInputs,
  report: VerificationReport | CCVerificationReport,
): string[] {
  if (inputs.kind === "bank") {
    const bankReport = report as VerificationReport;
    if (!bankReport.reconciliation.passed) {
      const diff = bankReport.reconciliation.difference?.toFixed(2) ?? "unknown";
      return [
        `Bank statement verification failed: balance reconciliation difference ${diff}. Review carefully before import.`,
      ];
    }
    return [];
  }

  const ccReport = report as CCVerificationReport;
  if (!ccReport.passed) {
    return [
      "Credit card statement verification failed: totals or transaction sums do not fully reconcile. Review carefully before import.",
    ];
  }
  return [];
}

export function attachVerificationToExtractionBundle(
  bundle: ExtractionBundle,
): ExtractionBundle & {
  verificationReport?: VerificationReport | CCVerificationReport;
} {
  if (!bundle.verificationInputs) {
    return bundle;
  }

  if (bundle.verificationInputs.kind === "bank") {
    const report = verifyStatement(
      bundle.verificationInputs.rawText,
      bundle.verificationInputs.transactions,
      bundle.verificationInputs.meta,
    );

    return {
      ...bundle,
      transactions: mergeVerificationConfidence(bundle.transactions, report),
      verificationReport: report,
      warnings: [
        ...bundle.warnings,
        ...buildVerificationWarning(bundle.verificationInputs, report),
      ],
    };
  }

  const report = verifyCCStatement(
    bundle.verificationInputs.transactions,
    bundle.verificationInputs.meta,
  );
  const bankStyleReport = verifyStatement(
    bundle.verificationInputs.rawText,
    bundle.verificationInputs.transactions,
    {
      openingBalance: bundle.verificationInputs.meta.previousBalance,
      closingBalance: bundle.verificationInputs.meta.totalDue,
      currency: bundle.verificationInputs.meta.currency,
    },
  );

  return {
    ...bundle,
    transactions: mergeVerificationConfidence(bundle.transactions, bankStyleReport),
    verificationReport: report,
    warnings: [
      ...bundle.warnings,
      ...buildVerificationWarning(bundle.verificationInputs, report),
    ],
  };
}
