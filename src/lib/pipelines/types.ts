import type { StatementFormat, Currency, Transaction } from "@/types";
import type { StatementType, CreditCardStatement } from "@/types/creditCard";
import type { VerificationReport, CCVerificationReport } from "@/lib/verification/verificationEngine";
import type { CCSummary } from "@/lib/parsers/extractSummary";

export interface ExtractionBundle {
  transactions: Transaction[];
  currency: Currency | null;
  format: StatementFormat;
  fileName: string;
  parseDate: Date;
  statementType: StatementType | null;
  statementSummary?: CCSummary | null;
  verificationReport?: VerificationReport | CCVerificationReport;
  warnings: string[];
  errors: string[];
  rawText?: string;
  sourceMetadata?: {
    failedChunks?: string[];
  };
}

export interface ReviewSessionPayload {
  transactions: Transaction[];
  currency: Currency;
  format: StatementFormat;
  statementType: StatementType | null;
  fileName: string;
  parseDate: Date;
  statementSummary?: CCSummary | null;
  verificationReport?: VerificationReport | CCVerificationReport;
  warnings: string[];
  sourceMetadata?: {
    failedChunks?: string[];
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
