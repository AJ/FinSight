import type { Transaction } from "@/types";
import { getMerchantRuleDecision, getMerchantRuleInput } from "@/lib/categorization/merchantRules";
import { useMerchantRuleStore } from "@/lib/store/merchantRuleStore";

export function findMerchantRuleForTransaction(transaction: Transaction) {
  return useMerchantRuleStore.getState().getRule(getMerchantRuleInput(transaction));
}

export function teachMerchantRuleFromTransaction(transaction: Transaction): boolean {
  const decision = getMerchantRuleDecision(transaction);
  if (!decision) {
    return false;
  }

  useMerchantRuleStore.getState().upsertRule(decision);
  return true;
}

export function teachMerchantRulesFromConfirmedTransactions(
  originalTransactions: Transaction[],
  reviewedTransactions: Transaction[],
): number {
  const originalById = new Map(originalTransactions.map((transaction) => [transaction.id, transaction]));
  let learnedRuleUpdates = 0;

  for (const reviewedTransaction of reviewedTransactions) {
    const originalTransaction = originalById.get(reviewedTransaction.id);
    if (!originalTransaction) {
      continue;
    }

    const categoryChanged = reviewedTransaction.category.id !== originalTransaction.category.id;
    const manualCategoryEdit = reviewedTransaction.categorizedBy === "manual";

    if (!categoryChanged || !manualCategoryEdit) {
      continue;
    }

    if (teachMerchantRuleFromTransaction(reviewedTransaction)) {
      learnedRuleUpdates += 1;
    }
  }

  return learnedRuleUpdates;
}
