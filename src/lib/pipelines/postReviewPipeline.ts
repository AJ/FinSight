import type { CCSummary } from "@/lib/parsers/extractSummary";
import { reviewSessionRepository } from "@/lib/review/reviewSessionRepository";
import { teachMerchantRulesFromConfirmedTransactions } from "@/lib/services/merchantRuleService";
import { runPostImportJobs } from "@/lib/services/postImportJobService";
import type { ReviewFinalizeDependencies, ReviewFinalizeResult } from "./types";
import type { Transaction } from "@/types";
import type { CreditCardStatement } from "@/types/creditCard";

function toCreditCardStatement(summary: CCSummary, fileName: string): CreditCardStatement {
  return {
    id: crypto.randomUUID(),
    fileName,
    parseDate: new Date(),
    cardLastFour: summary.cardLastFour || "",
    cardIssuer: summary.cardIssuer || "",
    cardHolder: summary.cardHolder || undefined,
    statementPeriod:
      summary.statementPeriodStart && summary.statementPeriodEnd
        ? {
            start: new Date(summary.statementPeriodStart),
            end: new Date(summary.statementPeriodEnd),
          }
        : { start: new Date(), end: new Date() },
    statementDate: summary.statementDate ? new Date(summary.statementDate) : new Date(),
    paymentDueDate: summary.paymentDueDate ? new Date(summary.paymentDueDate) : new Date(),
    totalDue: summary.totalDue ?? 0,
    minimumDue: summary.minimumDue ?? 0,
    creditLimit: summary.creditLimit ?? 0,
    availableCredit: summary.availableCredit ?? 0,
    previousBalance: summary.previousBalance ?? 0,
    paymentsReceived: summary.paymentsReceived ?? 0,
    purchasesAndCharges: summary.purchasesAndCharges ?? 0,
    interestCharged: summary.interestCharged ?? 0,
    lateFee: summary.lateFee ?? 0,
    otherCharges: summary.otherCharges ?? 0,
    cashbackEarned: summary.cashbackEarned ?? 0,
    rewardPoints: summary.rewardPoints
      ? {
          openingBalance: summary.rewardPoints.opening ?? 0,
          earned: summary.rewardPoints.earned ?? 0,
          redeemed: summary.rewardPoints.redeemed ?? 0,
          expired: 0,
          closingBalance: summary.rewardPoints.closing ?? 0,
          expiringNext: undefined,
          expiringNextDate: undefined,
        }
      : undefined,
    isPaid: false,
  };
}

export async function finalizeReviewImport(
  reviewedTransactions: Transaction[],
  dependencies: ReviewFinalizeDependencies,
): Promise<ReviewFinalizeResult> {
  const reviewSession = reviewSessionRepository.load();
  if (!reviewSession) {
    throw new Error("No staged review session found.");
  }

  const learnedRuleUpdates = teachMerchantRulesFromConfirmedTransactions(
    reviewSession.transactions,
    reviewedTransactions,
  );

  const sourceFileHash = reviewSession.sourceMetadata?.sourceFileHash;
  const isDuplicateImport = reviewSession.sourceMetadata?.isDuplicateImport;
  const stampedTransactions = sourceFileHash
    ? reviewedTransactions.map((t) => t.cloneWith({ sourceFileHash }))
    : reviewedTransactions;

  dependencies.addTransactions(stampedTransactions, {
    skipDedup: isDuplicateImport === true,
  });

  const postImportJobsTriggered: string[] = [];
  const creditCardSummary =
    reviewSession.statementType === "credit_card" &&
    reviewSession.statementSummary &&
    "cardLastFour" in reviewSession.statementSummary
      ? (reviewSession.statementSummary as CCSummary)
      : null;

  if (creditCardSummary && dependencies.addCreditCardStatement) {
    dependencies.addCreditCardStatement(
      toCreditCardStatement(creditCardSummary, reviewSession.fileName),
    );
    postImportJobsTriggered.push("credit_card_statement_import");
  }

  postImportJobsTriggered.push(...runPostImportJobs());

  reviewSessionRepository.clear();

  return {
    importedCount: reviewedTransactions.length,
    learnedRuleUpdates,
    postImportJobsTriggered,
    warnings: reviewSession.warnings ?? [],
    errors: [],
  };
}
