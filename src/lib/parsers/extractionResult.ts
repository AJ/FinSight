import type { ExtractedTransaction } from "@/types/extractedTransaction";
import type { CCSummary, BankSummary } from "./extractSummary";
import type { RewardsOutput } from "./extractRewards";

export interface StatementExtractionData {
  statementType: "credit_card" | "bank";
  summary: CCSummary | BankSummary | null;
  transactions: ExtractedTransaction[];
  rewards: RewardsOutput | null;
  derived: {
    totalDebit: number;
    totalCredit: number;
    transactionCount: number;
  };
  meta: {
    warnings: string[];
    confidence: number;
    failedChunks?: string[];
  };
}
