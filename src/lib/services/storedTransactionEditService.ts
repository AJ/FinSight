import { Category, CategorizedBy, Transaction } from "@/types";
import { teachMerchantRuleFromTransaction } from "@/lib/services/merchantRuleService";

export function buildStoredTransactionCategoryUpdate(
  transaction: Transaction,
  categoryId: string,
  categorizedBy: CategorizedBy,
): Transaction {
  return Transaction.fromJSON({
    ...transaction.toJSON(),
    category: (Category.fromId(categoryId) ?? transaction.category).id,
    needsReview: false,
    categorizedBy,
  });
}

export function handleStoredTransactionManualCategoryEdit(
  transaction: Transaction,
  categoryId: string,
): Transaction {
  const updatedTransaction = buildStoredTransactionCategoryUpdate(
    transaction,
    categoryId,
    CategorizedBy.Manual,
  );

  teachMerchantRuleFromTransaction(updatedTransaction);
  return updatedTransaction;
}
