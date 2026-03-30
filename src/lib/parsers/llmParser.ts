import { ParsedStatement, Currency, LLMStatus, TransactionType, Transaction, SourceType } from "@/types";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { getBrowserClient } from "@/lib/llm/index";
import { LLMProvider } from "@/lib/llm/types";
import { debugLog, debugError } from "@/lib/utils/debug";
import { processStatement } from "./pipeline";
import { detectStatementType } from "./typeDetection";
import {
  TypeDetectionResult,
  StatementType,
} from "@/types/creditCard";

import {
  verifyStatement,
  verifyCCStatement,
  StatementMeta,
  CCStatementMeta,
  VerificationReport,
  CCVerificationReport,
} from "@/lib/verification/verificationEngine";
import { validateTransactions } from "@/lib/verification/validationEngine";
import { toast } from "sonner";
import type { CCSummary, BankSummary } from "./extractSummary";

/* ============================================================
   Password Error Detection
   Re-exported from pdfParser for consistency
   ============================================================ */

export function isPasswordError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const err = error as Record<string, unknown>;
  debugError('[llmparser.ts][Password Error Detection] Checking error:', err);

  // pdfjs-dist PasswordException has name 'PasswordException'
  if (err.name === "PasswordException") return true;

  // Check for password-related message
  if (
    typeof err.message === "string" &&
    err.message.toLowerCase().includes("password")
  ) {
    return true;
  }

  // pdfjs-dist error codes: 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD
  if (err.code === 1 || err.code === 2) return true;

  return false;
}

export class PDFPasswordError extends Error {
  public readonly code: number;

  constructor(message: string = "PDF is password protected", code: number = 1) {
    super(message);
    this.name = "PDFPasswordError";
    this.code = code;
  }
}

/**
 * Password reason codes from pdfjs-dist
 * 1 = NEED_PASSWORD - PDF is encrypted, no password provided yet
 * 2 = INCORRECT_PASSWORD - Password was attempted and failed
 */
export const PASSWORD_REASON = {
  NEED_PASSWORD: 1,
  INCORRECT_PASSWORD: 2,
} as const;

/**
 * Extract raw text from a PDF file using pdfjs-dist (runs in browser).
 * Preserves spatial layout for better LLM comprehension.
 *
 * @param file - The PDF file to extract text from
 * @param password - Optional password for encrypted PDFs
 */
export async function extractTextFromPDF(
  file: File,
  password?: string,
): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const arrayBuffer = await file.arrayBuffer();

  return new Promise((resolve, reject) => {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });

    // Synchronous password handler - must call updateCallback immediately
    // NOTE: The console.logs below are intentionally kept - they provide micro-delays
    // that prevent a race condition in pdfjs-dist's internal state machine when
    // bundled by Next.js/Turbopack. Removing them may cause password auth to fail.
    loadingTask.onPassword = (
      updateCallback: (password: string) => void,
      reason: number
    ) => {
      debugLog('[onPassword] reason:', reason, 'password provided:', !!password);
      if (reason === 1) {
        // NEED_PASSWORD
        if (password) {
          // Password provided - use it immediately (synchronous)
          updateCallback(password);
          debugLog('[onPassword] updateCallback called');
        } else {
          // No password - destroy task and reject
          loadingTask.destroy().finally(() => {
            reject(new PDFPasswordError("PDF requires a password", 1));
          });
        }
      } else {
        // INCORRECT_PASSWORD - destroy task and reject
        debugLog('[onPassword] reason=2, rejecting');
        loadingTask.destroy().finally(() => {
          reject(new PDFPasswordError("Incorrect password", 2));
        });
      }
    };

    loadingTask.promise
      .then(async (pdf) => {
        let fullText = "";

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();

          // Preserve spatial layout: group by Y, sort by X
          const items = textContent.items
            .filter(
              (item) =>
                "str" in item &&
                "transform" in item &&
                typeof (item as { str: string }).str === "string" &&
                (item as { str: string }).str.trim().length > 0
            )
            .map((item) => {
              const textItem = item as { str: string; transform: number[] };
              return {
                text: textItem.str.trim(),
                x: Math.round(textItem.transform[4]),
                y: Math.round(textItem.transform[5]),
              };
            });

          const lines: { y: number; items: { text: string; x: number }[] }[] = [];
          for (const item of items) {
            const existing = lines.find((l) => Math.abs(l.y - item.y) < 3);
            if (existing) {
              existing.items.push(item);
            } else {
              lines.push({ y: item.y, items: [item] });
            }
          }

          lines.sort((a, b) => b.y - a.y);
          for (const line of lines) {
            line.items.sort((a, b) => a.x - b.x);
            // Use tab separators between items that are far apart
            let prev = 0;
            const parts: string[] = [];
            for (const item of line.items) {
              if (prev > 0 && item.x - prev > 50) {
                parts.push("\t");
              }
              parts.push(item.text);
              prev = item.x + item.text.length * 5;
            }
            fullText += parts.join(" ") + "\n";
          }
          fullText += "\n--- PAGE BREAK ---\n\n";
        }

        resolve(fullText);
      })
      .catch((err: unknown) => {
        reject(err);
      });
  });
}

/**
 * Extract raw text from a CSV or XLS file (for sending to LLM).
 */
export async function extractTextFromTabular(file: File): Promise<string> {
  const ext = file.name.toLowerCase();

  if (ext.endsWith(".csv")) {
    return await file.text();
  }

  // XLS/XLSX — convert to CSV text
  const XLSX = await import("xlsx");
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });

  let text = "";
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(ws);
    text += `Sheet: ${sheetName}\n${csv}\n\n`;
  }
  return text;
}

/**
 * Check whether the LLM is reachable at the configured URL.
 * Calls the LLM directly from the browser (no server proxy).
 */
export async function checkLLMStatus(url?: string, provider?: LLMProvider): Promise<LLMStatus> {
  const settings = useSettingsStore.getState();
  const llmUrl = url || settings.ollamaUrl;
  const llmProvider = provider || settings.llmProvider;
  const client = getBrowserClient(llmProvider);
  return client.checkStatus(llmUrl);
}


/* ── Two-Pass Parsing for Statement Type Detection ─────────── */

const CC_PAYMENT_KEYWORDS = [
  'credit card', 'cc payment', 'card payment',
  'hdfc card', 'icici card', 'axis card', 'sbi card',
  'kotak card', 'citi card', 'amex card', 'idfc card',
  'tele-transfer', 'tele transfer', 'neft-hdfc', 'neft-icici',
  'neft-axis', 'neft-sbi', 'neft-kotak', 'billdesk*hdfc',
  'billdesk*icici', 'billdesk*axis', 'autopay cc',
];

const CC_ISSUERS = [
  'hdfc', 'icici', 'axis', 'sbi', 'kotak', 'citi',
  'amex', 'idfc', 'au bank', 'bob', 'canara', 'pnb',
  'hsbc', 'standard chartered', 'scb', 'rbl', 'yes bank',
];

/**
 * Detect if a transaction is a credit card payment
 */
export function isCCPayment(description: string, type?: TransactionType): boolean {
  const lower = description.toLowerCase();

  // Special handling for BillDesk: 
  // - If it's a CREDIT (money in), it's likely a CC bill payment being reflected.
  // - If it's a DEBIT (money out) WITHOUT a specific bank name, it could be a utility bill.
  if (lower.includes('billdesk')) {
    if (type === TransactionType.Credit) return true;
    // For debits, only count as CC payment if it mentions an issuer
    if (CC_ISSUERS.some(issuer => lower.includes(issuer))) return true;
    return false;
  }

  // Check for CC payment keywords
  if (CC_PAYMENT_KEYWORDS.some(kw => lower.includes(kw))) {
    return true;
  }

  // Flexible matches
  if (lower.includes('autopay') && lower.includes('cc')) {
    return true;
  }

  // Check for issuer + card/payment pattern
  if (CC_ISSUERS.some(issuer => lower.includes(issuer))) {
    if (lower.includes('card') || lower.includes('payment') || lower.includes('bill')) {
      return true;
    }
  }

  return false;
}

export function detectCurrencyFromText(text: string): string | null {
  const codeMatch = text.match(/\b(INR|USD|EUR|GBP|JPY|AUD|CAD)\b/);
  if (codeMatch) return codeMatch[1];

  if (text.includes("₹") || text.includes("Rupee")) return "INR";
  if (text.includes("$") || text.includes("Dollar")) return "USD";
  if (text.includes("€") || text.includes("Euro")) return "EUR";
  if (text.includes("£") || text.includes("Pound")) return "GBP";

  return null;
}

/**
 * Extended parse result including CC statement data
 */
export interface ExtendedParseResult {
  statement: ParsedStatement;
  currency: Currency;
  rawText: string;
  statementType: StatementType;
  ccStatement?: CCSummary;  // Use new pipeline type
  verification?: VerificationReport | CCVerificationReport;  // Support both report types
}

/**
 * Parse any file with two-pass approach (type detection + extraction)
 */
export async function parseWithLLMExtended(
  file: File,
  onProgress?: (status: string) => void,
  password?: string,
  statementType?: 'bank' | 'credit_card',  // Optional: skip auto-detection if provided
): Promise<ExtendedParseResult> {
  const ext = file.name.toLowerCase();
  const isPDF = ext.endsWith(".pdf");

  // 1 — Extract text
  onProgress?.("Extracting text from document...");
  const rawText = isPDF
    ? await extractTextFromPDF(file, password)
    : await extractTextFromTabular(file);

  if (!rawText.trim()) {
    throw new Error(
      "No text found in file. If it's a scanned PDF, try a text-based PDF instead.",
    );
  }

  // 2 — Pass 1: Detect statement type (or use provided type)
  let typeResult: TypeDetectionResult;
  
  if (statementType) {
    // User provided type - skip LLM detection
    typeResult = {
      statementType: statementType,
      confidence: 1.0,  // User selection is definitive
    };
    debugLog('[Parser] Using user-provided statement type:', statementType);
  } else {
    // Auto-detect using LLM (new pipeline's type detection)
    onProgress?.("Detecting statement type...");
    try {
      typeResult = await detectStatementType(rawText);
      debugLog('[Parser] Type detection result:', typeResult);
    } catch (e: unknown) {
      // Type detection failed - prompt user for manual selection
      debugError('[LLM Parser] Type detection failed:', e instanceof Error ? e.message : e);
      throw new Error(
        `Could not automatically detect statement type. ${e instanceof Error ? e.message : 'Unknown error'}`
      );
    }
  }

  // Determine format
  let format: "pdf" | "csv" | "xlsx" | "xls" = "pdf";
  if (ext.endsWith(".csv")) format = "csv";
  else if (ext.endsWith(".xlsx")) format = "xlsx";
  else if (ext.endsWith(".xls")) format = "xls";

  // 3 — Pass 2: Parse based on type
  const settingsCurrency = useSettingsStore.getState().currency;
  let transactions: Transaction[] = [];
  let currency: Currency = settingsCurrency;
  let ccStatement: CCSummary | undefined;
  let verificationReport: CCVerificationReport | VerificationReport | undefined;
  let failedChunks: string[] = [];

  // Validate type detection result
  if (!typeResult.statementType) {
    throw new Error(`Type detection failed: LLM returned undefined statementType. Response: ${JSON.stringify(typeResult)}`);
  }

  if (typeResult.confidence < 0.8) {
    throw new Error(
      `Type detection confidence too low (${typeResult.confidence} < 0.8). ` +
      `Please manually select the statement type and try again.`
    );
  }

  if (typeResult.statementType === 'credit_card') {
    // Credit card statement
    onProgress?.("Parsing credit card statement...");

    // === NEW MULTI-PASS PIPELINE ===
    console.log('[llmParser] Using NEW multi-pass pipeline for CC statement');
    const pipelineResult = await processStatement(rawText);
    
    if (!pipelineResult.success || !pipelineResult.data) {
      throw new Error(`Pipeline failed: ${pipelineResult.errors.join(', ')}`);
    }

    // Map new pipeline output to old format
    const pipelineSummary = pipelineResult.data.summary as CCSummary | null;

    // Validate LLM output structure before mapping
    const validationResult = validateTransactions(pipelineResult.data.transactions);
    if (!validationResult.valid) {
      throw new Error(`Transaction validation failed: ${validationResult.errors.join(', ')}`);
    }
    if (validationResult.warnings.length > 0) {
      console.warn('[LLM Parser] Transaction validation warnings:', validationResult.warnings);
    }

    // Map pipeline transactions to app Transaction model
    transactions = validationResult.data!.transactions.map(t =>
      Transaction.fromExtracted(t, settingsCurrency, SourceType.Bank)
    );

    // Use pipeline summary directly (new types)
    if (pipelineSummary && 'cardLastFour' in pipelineSummary) {
      ccStatement = pipelineSummary;
    }
    
    failedChunks = []; // New pipeline doesn't have failed chunks

    // Prefer detected local currency from CC transactions; fallback to user settings currency.
    currency = transactions.find((t) => t.localCurrency)?.localCurrency || settingsCurrency;

    if (ccStatement) {
      // Run CC verification (Approach B + C)
      onProgress?.("Verifying credit card statement...");

      const ccMeta: CCStatementMeta = {
        previousBalance: ccStatement.previousBalance ?? 0,
        totalDue: ccStatement.totalDue ?? 0,
        paymentsReceived: ccStatement.paymentsReceived ?? 0,
        purchasesAndCharges: ccStatement.purchasesAndCharges ?? 0,
        interestCharged: ccStatement.interestCharged ?? 0,
        lateFee: ccStatement.lateFee ?? 0,
        otherCharges: ccStatement.otherCharges ?? 0,
        cashbackEarned: ccStatement.cashbackEarned ?? 0,
        currency: currency.code,
      };

      const ccVerificationReport = verifyCCStatement(transactions, ccMeta);

      debugLog('[CC Verification] Report:', {
        statementTotals: ccVerificationReport.statementTotals,
        transactionSums: ccVerificationReport.transactionSums,
        overallConfidence: ccVerificationReport.overallConfidence,
        passed: ccVerificationReport.passed,
      });

      // Also run per-transaction verification to get confidence scores
      const rawTextForVerification = await extractTextFromPDF(file, password);
      const bankMeta: StatementMeta = {
        openingBalance: ccMeta.previousBalance,
        closingBalance: ccMeta.totalDue,
        currency: ccMeta.currency,
      };
      const perTxVerification = verifyStatement(rawTextForVerification, transactions, bankMeta);
      
      // Merge verification confidence onto transactions
      const verifiedMap = new Map(perTxVerification.verified.map(v => [v.id, v.confidence]));
      transactions = transactions.map(t => new Transaction(
        t.id, t.date, t.description, t.amount, t.type, t.category, t.balance, t.merchant,
        t.originalText, t.budgetMonth, t.categoryConfidence, t.needsReview, t.categorizedBy,
        t.sourceType, t.statementId, t.cardIssuer, t.cardLastFour, t.cardHolder,
        t.localCurrency, t.originalCurrency, t.originalAmount, t.isInternational,
        t.isAnomaly, t.anomalyTypes, t.anomalyDetails, t.anomalyDismissed,
        t.transactionSubType, t.suggestedCategory, t.llmConfidence, verifiedMap.get(t.id),
      ));

      // Store verification result in the return value (not on ccStatement)
      verificationReport = ccVerificationReport;

      // Show warning if verification failed
      if (!ccVerificationReport.passed) {
        debugError('[CC Verification] FAILED - Full Details:', {
          statementTotals: ccVerificationReport.statementTotals,
          transactionSums: ccVerificationReport.transactionSums,
          overallConfidence: ccVerificationReport.overallConfidence,
          formula: ccVerificationReport.statementTotals.formula,
        });

        toast.warning('Credit card statement verification failed', {
          description: 'Some transactions may be missing or miscategorized. Please review carefully and re-upload if required.',
          duration: 10000,
        });
      }
    }
  } else if (typeResult.statementType === 'bank') {
    // Bank statement
    onProgress?.("Parsing bank statement...");

    // === NEW MULTI-PASS PIPELINE ===
    console.log('[llmParser] Using NEW multi-pass pipeline for bank statement');
    const pipelineResult = await processStatement(rawText);

    if (!pipelineResult.success || !pipelineResult.data) {
      throw new Error(`Pipeline failed: ${pipelineResult.errors.join(', ')}`);
    }

    // Map new pipeline output to old format
    const pipelineSummary = pipelineResult.data.summary as BankSummary | null;

    // Validate LLM output structure before mapping
    const validationResult = validateTransactions(pipelineResult.data.transactions);
    if (!validationResult.valid) {
      throw new Error(`Transaction validation failed: ${validationResult.errors.join(', ')}`);
    }
    if (validationResult.warnings.length > 0) {
      console.warn('[LLM Parser] Transaction validation warnings:', validationResult.warnings);
    }

    // Map pipeline transactions to app Transaction model
    transactions = validationResult.data!.transactions.map(t =>
      Transaction.fromExtracted(t, settingsCurrency, SourceType.Bank)
    );

    failedChunks = []; // New pipeline doesn't have failed chunks

    // Prefer detected local currency from transactions; fallback to user settings currency.
    currency = transactions.find((t) => t.localCurrency)?.localCurrency || settingsCurrency;

    // Run bank verification (balance reconciliation)
    if (pipelineSummary) {
      onProgress?.("Verifying bank statement...");

      const bankMeta: StatementMeta = {
        openingBalance: pipelineSummary.openingBalance ?? undefined,
        closingBalance: pipelineSummary.closingBalance ?? undefined,
        currency: currency.code,
      };

      const bankVerificationReport = verifyStatement(rawText, transactions, bankMeta);

      debugLog('[Bank Verification] Report:', {
        verified: bankVerificationReport.verified.length,
        rejected: bankVerificationReport.rejected.length,
        duplicates: bankVerificationReport.duplicates.length,
        reconciliation: bankVerificationReport.reconciliation,
        overallConfidence: bankVerificationReport.overallConfidence,
      });

      // Merge verification confidence onto transactions
      const verifiedMap = new Map(bankVerificationReport.verified.map(v => [v.id, v.confidence]));
      transactions = transactions.map(t => new Transaction(
        t.id, t.date, t.description, t.amount, t.type, t.category, t.balance, t.merchant,
        t.originalText, t.budgetMonth, t.categoryConfidence, t.needsReview, t.categorizedBy,
        t.sourceType, t.statementId, t.cardIssuer, t.cardLastFour, t.cardHolder,
        t.localCurrency, t.originalCurrency, t.originalAmount, t.isInternational,
        t.isAnomaly, t.anomalyTypes, t.anomalyDetails, t.anomalyDismissed,
        t.transactionSubType, t.suggestedCategory, t.llmConfidence, verifiedMap.get(t.id),
      ));

      // Store verification result
      verificationReport = bankVerificationReport;

      // Show warning if verification failed
      if (!bankVerificationReport.reconciliation.passed) {
        const diff = bankVerificationReport.reconciliation.difference?.toFixed(2) ?? 'unknown';
        debugError('[Bank Verification] FAILED - Balance reconciliation:', {
          computedClosing: bankVerificationReport.reconciliation.computedClosing,
          expectedClosing: pipelineSummary.closingBalance,
          difference: diff,
        });

        toast.warning('Bank statement verification failed', {
          description: `Balance reconciliation failed. Difference: ${diff}. Please review carefully.`,
          duration: 10000,
        });
      }
    }
  } else {
    throw new Error(`Unknown statement type: ${typeResult.statementType}. This should not happen after validation.`);
  }

  onProgress?.(`Found ${transactions.length} transactions!`);

  return {
    statement: {
      transactions,
      format,
      fileName: file.name,
      parseDate: new Date(),
      failedChunks,
    },
    currency,
    rawText,
    statementType: typeResult.statementType,
    ccStatement,
    verification: verificationReport,
  };
}
