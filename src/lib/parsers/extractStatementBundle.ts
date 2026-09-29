import { processStatement } from "./pipeline";
import { parseCSV } from "./csvParser";
import { parseXLS } from "./xlsParser";
import { extractTextFromPDF } from "./documentExtraction";
import { ensureModelCalibrated } from "@/lib/llm/calibrationProbe";
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
  }, input.tables);

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

    // Run the calibration probe alongside PDF text extraction. The two share no resource —
    // pdfjs-dist is local CPU/memory work, the probe hits the network model — so concurrency is
    // free. But the probe dominates wall-clock: it asks the model to extract a ~40-line sample
    // (~3,900 completion tokens), which takes ~65-195s on local 1-4B hardware (180s timeout),
    // while PDF text extraction is only ~1-3s. The import blocks until both finish because the
    // transactions pass reads the cached ratios to size its chunks. On cache hit the probe is a
    // no-op, so already-calibrated imports pay nothing.
    const pdfPromise = extractTextFromPDF(input.file, input.password);
    const calibratePromise = ensureModelCalibrated(input.llmConfig, input.signal);

    const [{ text: rawText, tables }] = await Promise.all([pdfPromise, calibratePromise]);

    if (!rawText.trim()) {
      throw new Error(
        "No text found in file. If it's a scanned PDF, try a text-based PDF instead.",
      );
    }

    input.onProgress?.("Parsing statement...");
    return extractStatementBundleFromRawText({
      rawText,
      tables,
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
