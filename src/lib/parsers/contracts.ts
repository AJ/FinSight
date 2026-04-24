import type { StatementFormat, Currency, Transaction } from "@/types";
import type { StatementType } from "@/types/creditCard";
import type { LLMRuntimeConfig } from "@/lib/llm/types";
import type { BankSummary, CCSummary, Summary } from "./extractSummary";

export interface BankVerificationInputs {
  kind: "bank";
  rawText: string;
  transactions: Transaction[];
  meta: {
    openingBalance?: number;
    closingBalance?: number;
    currency?: string;
  };
  summary?: BankSummary | null;
}

export interface CreditCardVerificationInputs {
  kind: "credit_card";
  rawText: string;
  transactions: Transaction[];
  meta: {
    previousBalance?: number;
    totalDue?: number;
    paymentsReceived?: number;
    purchasesAndCharges?: number;
    interestCharged?: number;
    lateFee?: number;
    otherCharges?: number;
    cashbackEarned?: number;
    currency?: string;
  };
  summary?: CCSummary | null;
}

export type VerificationInputs = BankVerificationInputs | CreditCardVerificationInputs;

export interface ParsingError {
  rowIndex: number;
  rawRow: Record<string, unknown>;
  errorMessage: string;
}

export interface ExtractionBundle {
  transactions: Transaction[];
  currency: Currency | null;
  format: StatementFormat;
  fileName: string;
  parseDate: Date;
  statementType: StatementType | null;
  statementSummary?: Summary | null;
  verificationInputs?: VerificationInputs;
  warnings: string[];
  errors: string[];
  parsingErrors: ParsingError[];
  rawText?: string;
  sourceMetadata?: {
    failedChunks?: string[];
    sourceFileHash?: string;
  };
}

export interface ExtractStatementBundleFromFileInput {
  file: File;
  defaultCurrency: Currency;
  password?: string;
  statementType?: StatementType;
  onProgress?: (status: string) => void;
  signal?: AbortSignal;
  llmConfig?: LLMRuntimeConfig;
}

export interface ExtractStatementBundleFromRawTextInput {
  rawText: string;
  defaultCurrency: Currency;
  fileName: string;
  format: StatementFormat;
  statementType?: StatementType;
  signal?: AbortSignal;
  llmConfig: LLMRuntimeConfig;
}
