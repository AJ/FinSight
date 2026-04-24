import type { Currency, Transaction } from "@/types";
import type { CreditCardStatement, StatementType } from "@/types/creditCard";
import type {
  CCVerificationReport,
  VerificationReport,
} from "@/lib/verification/verificationEngine";
import type { Summary } from "@/lib/parsers/extractSummary";

export interface ReviewSessionPayload {
  transactions: Transaction[];
  currency: Currency;
  format: "csv" | "pdf" | "xlsx" | "xls";
  statementType: StatementType | null;
  fileName: string;
  parseDate: Date;
  statementSummary?: Summary | null;
  verificationReport?: VerificationReport | CCVerificationReport;
  warnings: string[];
  sourceMetadata?: {
    failedChunks?: string[];
    sourceFileHash?: string;
  };
}

export interface ReviewFinalizeResult {
  importedCount: number;
  learnedRuleUpdates: number;
  postImportJobsTriggered: string[];
  warnings: string[];
  errors: string[];
}

export interface ReviewFinalizeDependencies {
  addTransactions: (transactions: Transaction[]) => void;
  addCreditCardStatement?: (statement: CreditCardStatement) => void;
}
