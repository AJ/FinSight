import { parseCSV } from "@/lib/parsers/csvParser";
import { parseXLS } from "@/lib/parsers/xlsParser";
import { parseWithLLMExtended } from "@/lib/parsers/llmParser";
import { enrichImportedTransactions } from "@/lib/services/transactionEnrichmentService";
import { reviewSessionRepository } from "@/lib/review/reviewSessionRepository";
import type { Currency } from "@/types";
import type { LLMProvider } from "@/lib/llm/types";
import type { StatementType } from "@/types/creditCard";
import type { ExtractionBundle, ReviewSessionPayload } from "./types";

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
}

async function extractBundle(
  input: RunPreReviewPipelineInput,
): Promise<ExtractionBundle> {
  const ext = input.file.name.toLowerCase();

  if (ext.endsWith(".pdf")) {
    const result = await parseWithLLMExtended(
      input.file,
      input.onProgress,
      input.password,
      input.statementType,
      input.signal,
    );

    return {
      transactions: result.statement.transactions,
      currency: result.currency,
      format: result.statement.format,
      fileName: result.statement.fileName,
      parseDate: result.statement.parseDate,
      statementType: result.statementType,
      statementSummary: result.ccStatement ?? null,
      verificationReport: result.verification,
      warnings: [],
      errors: [],
      rawText: result.rawText,
      sourceMetadata: {
        failedChunks: result.statement.failedChunks,
      },
    };
  }

  if (ext.endsWith(".csv")) {
    input.onProgress?.("Parsing CSV...");
    const result = await parseCSV(input.file);
    return {
      transactions: result.statement.transactions,
      currency: result.detectedCurrency,
      format: result.statement.format,
      fileName: result.statement.fileName,
      parseDate: result.statement.parseDate,
      statementType: null,
      warnings: [],
      errors: [],
    };
  }

  if (ext.endsWith(".xls") || ext.endsWith(".xlsx")) {
    input.onProgress?.("Parsing Excel file...");
    const result = await parseXLS(input.file);
    return {
      transactions: result.statement.transactions,
      currency: result.detectedCurrency,
      format: result.statement.format,
      fileName: result.statement.fileName,
      parseDate: result.statement.parseDate,
      statementType: null,
      warnings: [],
      errors: [],
    };
  }

  throw new Error("Unsupported file format. Please upload a PDF, CSV, XLS, or XLSX file.");
}

export async function runPreReviewPipeline(
  input: RunPreReviewPipelineInput,
): Promise<ReviewSessionPayload> {
  const bundle = await extractBundle(input);

  input.onProgress?.("Categorizing transactions...");
  const transactions = await enrichImportedTransactions(bundle.transactions, {
    provider: input.provider,
    baseUrl: input.baseUrl,
    model: input.model,
    statementType: bundle.statementType || undefined,
  });

  const reviewSessionPayload: ReviewSessionPayload = {
    transactions,
    currency: bundle.currency ?? input.defaultCurrency,
    format: bundle.format,
    statementType: bundle.statementType,
    fileName: bundle.fileName,
    parseDate: bundle.parseDate,
    statementSummary: bundle.statementSummary,
    verificationReport: bundle.verificationReport,
    warnings: bundle.warnings,
    sourceMetadata: bundle.sourceMetadata,
  };

  reviewSessionRepository.save(reviewSessionPayload);
  return reviewSessionPayload;
}
