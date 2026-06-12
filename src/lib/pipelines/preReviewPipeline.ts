import { extractStatementBundleFromFile } from "@/lib/parsers/extractStatementBundle";
import { attachVerificationToExtractionBundle } from "@/lib/services/statementVerificationService";
import { enrichImportedTransactions } from "@/lib/services/transactionEnrichmentService";
import { reviewSessionRepository } from "@/lib/review/reviewSessionRepository";
import { debugLog } from "@/lib/utils/debug";
import type { Currency } from "@/types";
import type { LLMProvider } from "@/lib/llm/types";
import type { StatementType } from "@/types/creditCard";
import type { ReviewSessionPayload } from "./types";

export interface RunPreReviewPipelineInput {
  file: File;
  provider: LLMProvider;
  baseUrl: string;
  model?: string;
  defaultCurrency: Currency;
  password?: string;
  statementType?: StatementType;
  onProgress?: (status: string) => void;
  signal?: AbortSignal;
  sourceFileHash?: string;
  isDuplicateImport?: boolean;
}

export async function runPreReviewPipeline(
  input: RunPreReviewPipelineInput,
): Promise<ReviewSessionPayload> {
  const extractedBundle = await extractStatementBundleFromFile({
    file: input.file,
    defaultCurrency: input.defaultCurrency,
    password: input.password,
    statementType: input.statementType,
    onProgress: input.onProgress,
    signal: input.signal,
    llmConfig: {
      provider: input.provider,
      baseUrl: input.baseUrl,
      model: input.model ?? "",
    },
  });

  const verifiedBundle = attachVerificationToExtractionBundle(extractedBundle);

  input.onProgress?.("Categorizing transactions...");
  const transactions = await enrichImportedTransactions(verifiedBundle.transactions, {
    provider: input.provider,
    baseUrl: input.baseUrl,
    model: input.model,
    statementType: verifiedBundle.statementType || undefined,
  });

  // Log suspense-flagged transactions for observability
  const suspenseCount = transactions.filter(t => t.isSuspense).length;
  if (suspenseCount > 0) {
    debugLog('Suspense', `${suspenseCount} transaction(s) flagged as suspense`);
    for (const txn of transactions) {
      if (txn.isSuspense) {
        debugLog('Suspense', 'Flagged transaction', {
          description: txn.description?.substring(0, 80),
          subType: txn.transactionSubType,
          suggestedCategory: txn.category?.id,
          confidence: txn.categoryConfidence,
        });
      }
    }
  }

  const reviewSessionPayload: ReviewSessionPayload = {
    transactions,
    currency: verifiedBundle.currency ?? input.defaultCurrency,
    format: verifiedBundle.format,
    statementType: verifiedBundle.statementType,
    fileName: verifiedBundle.fileName,
    parseDate: verifiedBundle.parseDate,
    statementSummary: verifiedBundle.statementSummary,
    verificationReport: verifiedBundle.verificationReport,
    warnings: verifiedBundle.warnings,
    sourceMetadata: {
      ...verifiedBundle.sourceMetadata,
      sourceFileHash: input.sourceFileHash,
      isDuplicateImport: input.isDuplicateImport,
    },
  };

  reviewSessionRepository.save(reviewSessionPayload);
  return reviewSessionPayload;
}
