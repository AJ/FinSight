import type { Currency, Transaction } from "@/types";
import type { CreditCardStatement, StatementType } from "@/types/creditCard";
import type { VerificationReport } from "@/lib/verification/verificationEngine";
import type { Summary } from "@/lib/parsers/extractSummary";
import type { BankStatementSummary } from "@/models/BankStatementSummary";

export interface ReviewSessionPayload {
  transactions: Transaction[];
  currency: Currency;
  format: "csv" | "pdf" | "xlsx" | "xls";
  statementType: StatementType | null;
  fileName: string;
  parseDate: Date;
  statementSummary?: Summary | null;
  verificationReport?: VerificationReport;
  warnings: string[];
  sourceMetadata?: {
    failedChunks?: string[];
    sourceFileHash?: string;
    isDuplicateImport?: boolean;
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
  addTransactions: (transactions: Transaction[], options?: { skipDedup?: boolean }) => void;
  addCreditCardStatement?: (statement: CreditCardStatement) => void;
  addBankSummary?: (summary: BankStatementSummary) => void;
}
