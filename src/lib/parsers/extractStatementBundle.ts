import { processStatement } from "./pipeline";
import { parseCSV } from "./csvParser";
import { parseXLS } from "./xlsParser";
import { extractTextFromPDF } from "./documentExtraction";
import type {
  ExtractStatementBundleFromFileInput,
  ExtractStatementBundleFromRawTextInput,
  ExtractionBundle,
} from "./contracts";

export async function extractStatementBundleFromRawText(
  input: ExtractStatementBundleFromRawTextInput,
): Promise<ExtractionBundle> {
  const pipelineResult = await processStatement(input.rawText, {
    format: input.format,
    defaultCurrency: input.defaultCurrency,
    fileName: input.fileName,
    statementType: input.statementType ?? undefined,
    signal: input.signal,
    llmConfig: input.llmConfig,
  });

  if (!pipelineResult.success || !pipelineResult.data) {
    throw new Error(`Pipeline failed: ${pipelineResult.errors.join(", ")}`);
  }

  return pipelineResult.data;
}

export async function extractStatementBundleFromFile(
  input: ExtractStatementBundleFromFileInput,
): Promise<ExtractionBundle> {
  const ext = input.file.name.toLowerCase();

  if (ext.endsWith(".pdf")) {
    if (!input.llmConfig) {
      throw new Error("LLM runtime configuration is required for PDF statement parsing.");
    }

    input.onProgress?.("Extracting text from document...");
    const rawText = await extractTextFromPDF(input.file, input.password);

    if (!rawText.trim()) {
      throw new Error(
        "No text found in file. If it's a scanned PDF, try a text-based PDF instead.",
      );
    }

    input.onProgress?.("Parsing statement...");
    return extractStatementBundleFromRawText({
      rawText,
      defaultCurrency: input.defaultCurrency,
      fileName: input.file.name,
      format: "pdf",
      statementType: input.statementType,
      signal: input.signal,
      llmConfig: input.llmConfig,
    });
  }

  if (ext.endsWith(".csv")) {
    input.onProgress?.("Parsing CSV...");
    return parseCSV(input.file, { statementType: input.statementType });
  }

  if (ext.endsWith(".xls") || ext.endsWith(".xlsx")) {
    input.onProgress?.("Parsing Excel file...");
    return parseXLS(input.file, { statementType: input.statementType });
  }

  throw new Error("Unsupported file format. Please upload a PDF, CSV, XLS, or XLSX file.");
}
