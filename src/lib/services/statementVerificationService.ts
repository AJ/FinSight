import { Transaction } from "@/types";
import { verifyStatement } from "@/lib/verification/verificationEngine";
import type { VerificationReport } from "@/lib/verification/verificationEngine";
import type { ExtractionBundle } from "@/lib/parsers/contracts";

function mergeVerificationConfidence(
  transactions: Transaction[],
  report: VerificationReport,
): Transaction[] {
  const verifiedMap = new Map(
    report.verified.map((t) => [t.id, t.confidence]),
  );

  return transactions.map((t) =>
    Transaction.fromJSON({
      ...t.toJSON(),
      verificationConfidence: verifiedMap.get(t.id),
    }),
  );
}

function buildVerificationWarning(
  inputs: ExtractionBundle['verificationInputs'],
  report: VerificationReport,
): string[] {
  if (!inputs) return [];

  if (inputs.kind === "bank") {
    if (!report.reconciliation.passed) {
      // Primary failure: numbers don't balance
      const diff = report.reconciliation.difference?.toFixed(2) ?? "unknown";
      const flagged = report.rejected.length;
      return [
        `Balance reconciliation difference of ${diff}.` +
        (flagged > 0 ? ` ${flagged} transaction(s) flagged.` : '') +
        ` Review carefully or re-upload the statement.`,
      ];
    }

    if (report.rejected.length > 0) {
      // Numbers balance but some transactions unverified
      return [
        `Reconciliation balanced but ${report.rejected.length} transaction(s) ` +
        `could not be verified against source text ` +
        `(overall confidence: ${report.overallConfidence}%). ` +
        `Review flagged transactions before import.`,
      ];
    }

    return [];
  }

  // CC: check ccAggregate
  if (report.ccAggregate) {
    const totalsPassed = report.ccAggregate.statementTotals.passed;
    const sumsPassed = report.ccAggregate.transactionSums.passed;

    if (!totalsPassed && !sumsPassed) {
      const flagged = report.rejected.length;
      return [
        `Credit card statement verification failed: totals and transaction sums do not reconcile.` +
        (flagged > 0 ? ` ${flagged} transaction(s) flagged.` : '') +
        ` Review carefully before import.`,
      ];
    }

    if (!totalsPassed) {
      return [
        `Credit card statement totals do not fully reconcile. Review carefully before import.`,
      ];
    }

    if (!sumsPassed) {
      return [
        `Credit card transaction sums do not fully reconcile. Review flagged transactions before import.`,
      ];
    }

    if (report.rejected.length > 0) {
      return [
        `Reconciliation balanced but ${report.rejected.length} transaction(s) ` +
        `could not be verified against source text ` +
        `(overall confidence: ${report.overallConfidence}%). ` +
        `Review flagged transactions before import.`,
      ];
    }
  }

  return [];
}

export function attachVerificationToExtractionBundle(
  bundle: ExtractionBundle,
): ExtractionBundle & { verificationReport?: VerificationReport } {
  if (!bundle.verificationInputs) return bundle;

  const inputs = bundle.verificationInputs;

  const report = verifyStatement(
    inputs.rawText,
    inputs.transactions,
    { kind: inputs.kind, ...inputs.meta },
  );

  return {
    ...bundle,
    transactions: mergeVerificationConfidence(bundle.transactions, report),
    verificationReport: report,
    warnings: [
      ...bundle.warnings,
      ...buildVerificationWarning(inputs, report),
    ],
  };
}
