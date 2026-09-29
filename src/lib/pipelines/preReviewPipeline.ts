import { extractStatementBundleFromFile } from "@/lib/parsers/extractStatementBundle";
import { attachVerificationToExtractionBundle } from "@/lib/services/statementVerificationService";
import { enrichImportedTransactions } from "@/lib/services/transactionEnrichmentService";
import { reviewSessionRepository } from "@/lib/review/reviewSessionRepository";
import { applyVerificationReviewReasons } from "@/lib/review/applyVerificationReviewReasons";
import { stampMissingSourceLines } from "@/lib/review/stampMissingSourceLines";
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

  input.onProgress?.("Classifying transactions...");
  const classified = await enrichImportedTransactions(extractedBundle.transactions, {
    provider: input.provider,
    baseUrl: input.baseUrl,
    model: input.model,
    statementType: extractedBundle.statementType || undefined,
    signal: input.signal,
  });

  // Verify AFTER classification (D3): CC subtype reconciliation consumes subtype, so subtype
  // must exist before verification runs. Classification (above) is now the subtype authority.
  // Bank reconciliation is subtype-independent. Spread the classified transactions onto the
  // bundle so verification sees them alongside the summary.
  const verifiedBundle = attachVerificationToExtractionBundle({
    ...extractedBundle,
    transactions: classified,
  });

  // Assign review reasons (spec §6). Runs unconditionally — CSV/XLS imports carry
  // no verification report, and the report is optional. Runs after classification so
  // classification-derived reasons are already set; hard reasons are preserved.
  const reviewed = applyVerificationReviewReasons(
    verifiedBundle.transactions,
    verifiedBundle.verificationReport,
  );

  // Advisory flag for PDF rows that never got a line number (row-identity spec §6).
  const stamped = stampMissingSourceLines(reviewed, verifiedBundle.format);

  // Log unresolved-transfer transactions for observability. The self_transfer_unresolved
  // reason is stamped deterministically by the classification pass when subtype = self_transfer.
  const unresolvedTransferCount = stamped.filter((t) => t.reviewReasons.includes('self_transfer_unresolved')).length;
  if (unresolvedTransferCount > 0) {
    debugLog('Suspense', `${unresolvedTransferCount} transaction(s) flagged as unresolved transfer`);
    for (const txn of stamped) {
      if (txn.reviewReasons.includes('self_transfer_unresolved')) {
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
    transactions: stamped,
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
