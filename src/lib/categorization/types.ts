import type { SourceType, Transaction } from "@/types";
import { normalizeTransactionType, TransactionType } from "@/models/TransactionType";
import type { TransactionSubType } from "@/models/Transaction";

export type CategorizationSource = "rule" | "ai" | "keyword";

export interface CategorizationResult {
  id: string;
  category: string;
  confidence: number;
  source: CategorizationSource;
}

export interface CategorizationProgress {
  total: number;
  processed: number;
  current: number;
}

export interface CategorizationTransactionInput {
  id: string;
  description: string;
  amount: number;
  type: "credit" | "debit";
  merchant?: string;
  sourceType?: SourceType;
  transactionSubType?: TransactionSubType;
  categoryId?: string;
}

export function toCategorizationInput(
  transaction: Transaction
): CategorizationTransactionInput {
  return {
    id: transaction.id,
    description: transaction.description,
    amount: transaction.amount,
    type: transaction.type,
    merchant: transaction.merchant,
    sourceType: transaction.sourceType,
    transactionSubType: transaction.transactionSubType,
    categoryId: transaction.category.id,
  };
}

export function toTransactionType(type: "credit" | "debit"): TransactionType {
  return normalizeTransactionType(type) ?? TransactionType.Debit;
}
