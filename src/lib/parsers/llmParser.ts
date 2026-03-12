import { ParsedStatement, Currency, LLMStatus, TransactionType, Transaction, Category, SourceType } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { getBrowserClient } from "@/lib/llm/index";
import { LLMProvider, LLMClient } from "@/lib/llm/types";
import { debugLog } from "@/lib/utils/debug";
import { getTransactionSignature } from "@/lib/transactionUtils";
import {
  CreditCardStatement,
  TypeDetectionResult,
  CCExtractionResult,
  StatementType,
} from "@/types/creditCard";
import {
  TYPE_DETECTION_PROMPT,
  CC_EXTRACTION_PROMPT,
  parseTypeDetectionResult,
  parseCCExtractionResult,
  validateCCExtractionResult,
  getTextForDetection,
} from "@/lib/llm/ccPrompts";
import { createCreditCardStatement } from "@/lib/store/creditCardStore";
import {
  verifyStatement,
  ParsedTransaction,
  StatementMeta,
  VerificationReport,
} from "@/lib/verification/verificationEngine";
import { getCurrencyByCode } from "@/lib/currencyFormatter";
import { normalizeTransactionType } from "@/lib/utils/transactionType";

/* ============================================================
   LLM-POWERED PARSER
   Works with PDF, CSV, and XLS files.
   Sends extracted text to local Ollama for transaction parsing.
   ============================================================ */

function getLLMSettings() {
  const { llmProvider, ollamaUrl, llmModel } = useSettingsStore.getState();
  return { provider: llmProvider, url: ollamaUrl, model: llmModel };
}

async function resolveModelOrThrow(
  provider: LLMProvider,
  url: string,
  configuredModel?: string,
): Promise<string> {
  const normalizedModel = typeof configuredModel === 'string'
    ? configuredModel.trim()
    : '';

  if (normalizedModel.length > 0) {
    return normalizedModel;
  }

  const client = getBrowserClient(provider);
  const models = await client.listModels(url);
  const selectedModel = models[0];

  if (!selectedModel) {
    throw new Error(
      "No AI model available. Pull/load a model first (e.g. ollama pull llama3.2)",
    );
  }

  return selectedModel;
}

/* ============================================================
   Password Error Detection
   Re-exported from pdfParser for consistency
   ============================================================ */

export function isPasswordError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const err = error as Record<string, unknown>;

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
        console.log('[onPassword] reason=2, rejecting');
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
 * Parse any file (PDF, CSV, XLS) using the local LLM.
 */
export async function parseWithLLM(
  file: File,
  onProgress?: (status: string) => void,
  password?: string,
): Promise<{
  statement: ParsedStatement;
  currency: Currency;
  rawText: string;
}> {
  const { provider, url, model } = getLLMSettings();
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

  // 2 — Send to LLM (directly from browser)
  onProgress?.("AI is analysing your statement — this may take a moment...");

  const selectedModel = await resolveModelOrThrow(provider, url, model ?? undefined);

  const result = await parseLLMDirect(provider, url, selectedModel, rawText);

  if (!result.transactions || result.transactions.length === 0) {
    throw new Error("AI could not find any transactions in the document.");
  }

  onProgress?.(`Found ${result.transactions.length} transactions!`);

  // 3 — Convert to Transaction objects
  const otherCategory = Category.fromId(Category.DEFAULT_ID)!;
  const seen = new Set<string>();
  const transactions: Transaction[] = (
    result.transactions as {
      date: string;
      description: string;
      amount: number;
      type: string;
    }[]
  )
    .map((t) => new Transaction(
      uuidv4(),
      new Date(t.date),
      t.description,
      Math.abs(t.amount),
      t.type as TransactionType,
      otherCategory,
      undefined, // balance
      undefined, // merchant
      t.description, // originalText
    ))
    .filter((t) => !isNaN(t.date.getTime()) && t.amount !== 0)
    .filter((t) => {
      const sig = getTransactionSignature(t);
      if (seen.has(sig)) {
        debugLog('[LLMParser] Duplicate transaction filtered:', t.description);
        return false;
      }
      seen.add(sig);
      return true;
    });

  const currency: Currency = {
    code: result.currency?.code || "USD",
    symbol: result.currency?.symbol || "$",
    name: result.currency?.name || "US Dollar",
  };

  // Determine format
  let format: "pdf" | "csv" | "xlsx" | "xls" = "pdf";
  if (ext.endsWith(".csv")) format = "csv";
  else if (ext.endsWith(".xlsx")) format = "xlsx";
  else if (ext.endsWith(".xls")) format = "xls";

  return {
    statement: {
      transactions,
      format,
      fileName: file.name,
      parseDate: new Date(),
    },
    currency,
    rawText,
  };
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

/* ── Direct LLM parsing (browser → Ollama) ───────────────── */

const PARSE_PROMPT = `You are an expert bank statement parser. Your job is to extract ALL financial transactions from the raw text of a bank statement.

IMPORTANT RULES:
1. Extract EVERY single transaction — do NOT skip any.
2. Auto-detect the currency from the statement (look for symbols like ₹, $, €, £, ¥ or words like Rupee, Dollar, Euro, or ISO codes like INR, USD, EUR).
3. Auto-detect the date format used (DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-Mon-YYYY, etc.).
4. For each transaction, extract:
   - date: in YYYY-MM-DD format
   - description: the payee, merchant, or narration text
   - amount: the absolute numeric value (always positive)
   - type: "debit" for money going out (withdrawals/payments/expenses), "credit" for money coming in (deposits/transfers-in/refunds)
5. Look for these clues to determine type:
   - Separate "Debit" and "Credit" columns → debit column = "debit", credit column = "credit"
   - Keywords indicating DEBIT: DEBIT, DR, WITHDRAWAL, PAID, SENT, OUT, PAYMENT TO, TRANSFER TO, NEFT-OUT, IMPS-OUT
   - Keywords indicating CREDIT: CREDIT, CR, DEPOSIT, RECEIVED, IN, REFUND, TRANSFER FROM, NEFT-IN, IMPS-IN, UPI-CREDIT, CASH DEPOSIT
   - Negative amounts or amounts in parentheses = debit
   - Column headers like "Money Out" vs "Money In" → out = debit, in = credit
   - TRANSFERS: "Transfer from X" or "Received from X" = credit; "Transfer to X" or "Sent to X" = debit
6. EXTRACT BALANCE INFORMATION:
   - openingBalance: the account balance at the START of the statement period (look for "Opening Balance", "Brought Forward", "Balance B/F", starting balance)
   - closingBalance: the account balance at the END of the statement period (look for "Closing Balance", "Carried Forward", "Balance C/F", ending balance)
   - These are CRITICAL for verification - extract them as numbers (positive for credit balance, negative for overdraft)
7. Do NOT include opening/closing balance rows as transactions — only actual transactions.
8. Do NOT hallucinate transactions. Only extract what is actually in the text.
9. Output ONLY valid JSON — no markdown fences, no explanation, no extra text.

REQUIRED JSON FORMAT:
{"currency":{"code":"INR","symbol":"₹","name":"Indian Rupee"},"openingBalance":50000.00,"closingBalance":45000.00,"transactions":[{"date":"2024-01-15","description":"Amazon Purchase","amount":500.00,"type":"debit"},{"date":"2024-01-20","description":"Salary Credit","amount":50000.00,"type":"credit"}]}

BANK STATEMENT TEXT:
---
`;

function splitTextIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";

  const headerLines = lines.slice(0, 5).join("\n");

  for (const line of lines) {
    if ((current + "\n" + line).length > maxChars && current.length > 0) {
      chunks.push(current);
      current = headerLines + "\n...\n" + line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function safeParseJSON(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw);
  } catch {
    /* continue */
  }

  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      /* continue */
    }
  }

  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      /* continue */
    }

    let fixed = match[0];
    fixed = fixed.replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(fixed);
    } catch {
      /* continue */
    }
  }

  return null;
}

export async function parseLLMDirect(
  provider: LLMProvider,
  baseUrl: string,
  model: string,
  text: string,
  customClient?: LLMClient,
): Promise<{
  currency: Record<string, string> | null;
  transactions: Record<string, unknown>[];
  openingBalance?: number;
  closingBalance?: number;
  failedChunks: string[];
}> {
  type NormalizedLLMTransaction = {
    date: string;
    description: string;
    amount: number;
    type: 'credit' | 'debit';
  };

  const parseAmount = (value: unknown): number | null => {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const cleaned = value.replace(/[^\d.-]/g, '');
      if (!cleaned) return null;
      const parsed = Number.parseFloat(cleaned);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const normalizeType = (value: unknown): 'credit' | 'debit' | null => {
    // Use shared utility for standard types
    const standard = normalizeTransactionType(value);
    if (standard) return standard;
    
    // Also accept LLM-specific variations
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return null;

    const compact = raw.replace(/[\s_-]+/g, '');
    if (
      compact === 'cr' ||
      compact === 'in' ||
      compact === 'moneyin' ||
      compact === 'deposit' ||
      compact === 'refund' ||
      compact === 'received'
    ) {
      return 'credit';
    }
    if (
      compact === 'dr' ||
      compact === 'out' ||
      compact === 'moneyout' ||
      compact === 'withdrawal' ||
      compact === 'payment' ||
      compact === 'sent'
    ) {
      return 'debit';
    }
    return null;
  };

  const normalizeLLMTransaction = (rawTxn: Record<string, unknown>): NormalizedLLMTransaction | null => {
    const date = String(rawTxn.date || '').trim();
    const description = String(rawTxn.description || '').trim();
    const amount = parseAmount(rawTxn.amount);
    const type = normalizeType(rawTxn.type);

    if (!date || !description || amount === null || type === null || amount === 0) {
      return null;
    }

    return {
      date,
      description,
      amount: Math.abs(amount),
      type,
    };
  };

  const client = customClient || getBrowserClient(provider);
  const allTransactions: Record<string, unknown>[] = [];
  const failedChunks: string[] = [];
  let currency: Record<string, string> | null = null;
  let openingBalance: number | undefined;
  let closingBalance: number | undefined;

  // Recursive function to process text with retry
  // If a chunk fails, it splits it in half and tries again (up to maxDepth)
  const processChunkWithRetry = async (
    chunkText: string,
    depth: number = 0,
    chunkId: string
  ): Promise<void> => {
    const MAX_DEPTH = 2; // Allow splitting once or twice (1/2, 1/4 size)

    const prompt =
      PARSE_PROMPT + chunkText + "\n---\n\nExtract all transactions as JSON:";

    try {
      const raw = await client.generate(baseUrl, model, prompt, {
        temperature: 0.05,
      });

      const parsed = safeParseJSON(raw);
      if (parsed) {
        if (Array.isArray(parsed.transactions)) {
          allTransactions.push(
            ...(parsed.transactions as Record<string, unknown>[]),
          );
        }
        if (parsed.currency && !currency) {
          currency = parsed.currency as Record<string, string>;
        }
        if (
          openingBalance === undefined &&
          typeof parsed.openingBalance === 'number' &&
          Number.isFinite(parsed.openingBalance)
        ) {
          openingBalance = parsed.openingBalance;
        }
        if (
          typeof parsed.closingBalance === 'number' &&
          Number.isFinite(parsed.closingBalance)
        ) {
          closingBalance = parsed.closingBalance;
        }
      } else {
        // Valid JSON not found, treat as failure to trigger retry/split
        throw new Error("Invalid JSON response");
      }
    } catch (err) {
      console.error(`[LLM Parse] Chunk ${chunkId} failed (depth ${depth}):`, err);

      if (depth < MAX_DEPTH && chunkText.length > 500) {
        debugLog(`[LLM Parse] Retrying chunk ${chunkId} by splitting...`);
        // Split in half at the nearest newline
        const midpoint = Math.floor(chunkText.length / 2);
        const splitIndex = chunkText.lastIndexOf('\n', midpoint);
        
        // If no newline found near middle, force split
        const safeSplitIndex = splitIndex > 0 ? splitIndex : midpoint;

        const part1 = chunkText.slice(0, safeSplitIndex);
        const part2 = chunkText.slice(safeSplitIndex);

        await processChunkWithRetry(part1, depth + 1, `${chunkId}.1`);
        await processChunkWithRetry(part2, depth + 1, `${chunkId}.2`);
      } else {
        // Final failure
        debugLog(`[LLM Parse] Chunk ${chunkId} permanently failed.`);
        failedChunks.push(`Chunk ${chunkId} (${chunkText.slice(0, 30)}...)`);
      }
    }
  };

  const MAX_CHUNK_CHARS = 12000;
  const initialChunks = splitTextIntoChunks(text, MAX_CHUNK_CHARS);

  for (let i = 0; i < initialChunks.length; i++) {
    await processChunkWithRetry(initialChunks[i], 0, `${i + 1}`);
  }

  // Keep all normalized rows for verification (do not pre-dedupe here).
  const normalizedTransactions = allTransactions
    .map((t) => normalizeLLMTransaction(t))
    .filter((t): t is NormalizedLLMTransaction => t !== null);

  return {
    currency,
    transactions: normalizedTransactions,
    openingBalance,
    closingBalance,
    failedChunks,
  };
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

function normalizeCCDescription(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCCWeakKey(txn: Transaction): string {
  const dateKey = txn.date.toISOString().split('T')[0];
  const descKey = normalizeCCDescription(txn.description).slice(0, 40);
  const amountKey = Math.abs(txn.amount).toFixed(2);
  return `${dateKey}|${amountKey}|${txn.type}|${descKey}`;
}

function getAmountSearchVariants(amount: number): string[] {
  const absAmount = Math.abs(amount);
  const variants = [
    absAmount.toFixed(2),
    absAmount.toFixed(0),
    absAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    absAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    absAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 }),
    absAmount.toLocaleString('en-US', { maximumFractionDigits: 0 }),
  ];
  return [...new Set(variants.filter((v) => v.length > 0))];
}

function getDateSearchVariants(date: Date): string[] {
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const y = date.getFullYear().toString();

  const variants = [
    `${y}-${m}-${d}`,
    `${d}-${m}-${y}`,
    `${d}/${m}/${y}`,
    `${m}/${d}/${y}`,
    `${d}.${m}.${y}`,
  ];

  return [...new Set(variants)];
}

function getDescriptionAnchorToken(description: string): string {
  const tokens = normalizeCCDescription(description)
    .split(' ')
    .filter((t) => t.length >= 4);
  return tokens[0] || '';
}

function findCCEvidenceAnchors(rawText: string, txn: Transaction): number[] {
  const amountVariants = getAmountSearchVariants(txn.amount);
  const dateVariants = getDateSearchVariants(txn.date);
  const descToken = getDescriptionAnchorToken(txn.description);
  const anchors: number[] = [];

  const lowerRaw = rawText.toLowerCase();

  for (const amount of amountVariants) {
    let searchFrom = 0;

    while (searchFrom < rawText.length) {
      const idx = rawText.indexOf(amount, searchFrom);
      if (idx === -1) break;

      const windowStart = Math.max(0, idx - 120);
      const windowEnd = Math.min(rawText.length, idx + 120);
      const windowText = rawText.slice(windowStart, windowEnd);
      const windowLower = lowerRaw.slice(windowStart, windowEnd);

      const hasDate = dateVariants.some((dv) => windowText.includes(dv));
      const hasDescription = descToken ? windowLower.includes(descToken) : true;

      if (hasDate && hasDescription) {
        anchors.push(idx);
      }

      searchFrom = idx + Math.max(1, amount.length);
    }
  }

  return [...new Set(anchors)].sort((a, b) => a - b);
}

function dedupeCCTransactionsWithAnchors(
  transactions: Transaction[],
  rawText: string
): Transaction[] {
  const unique: Transaction[] = [];
  const seenAnchored = new Set<string>();
  const occurrenceByWeakKey = new Map<string, number>();
  const anchorsByWeakKey = new Map<string, number[]>();

  for (const txn of transactions) {
    const weakKey = getCCWeakKey(txn);
    const occurrence = occurrenceByWeakKey.get(weakKey) || 0;
    occurrenceByWeakKey.set(weakKey, occurrence + 1);

    let anchors = anchorsByWeakKey.get(weakKey);
    if (!anchors) {
      anchors = findCCEvidenceAnchors(rawText, txn);
      anchorsByWeakKey.set(weakKey, anchors);
    }

    // If no row-level anchors found, preserve the row to avoid false transaction loss.
    if (anchors.length === 0) {
      unique.push(txn);
      continue;
    }

    // Single-anchor duplicates are likely chunk-overlap repeats of the same row.
    if (anchors.length === 1 && occurrence > 0) {
      debugLog('[LLMParser] Dropping probable duplicate CC row:', txn.description);
      continue;
    }

    // If we have more extracted rows than detected anchors, keep extras (loss-averse behavior).
    if (occurrence >= anchors.length) {
      unique.push(txn);
      continue;
    }

    const anchorBucket = Math.floor(anchors[occurrence] / 8);
    const anchoredKey = `${weakKey}|${anchorBucket}`;
    if (seenAnchored.has(anchoredKey)) {
      debugLog('[LLMParser] Dropping anchored duplicate CC row:', txn.description);
      continue;
    }

    seenAnchored.add(anchoredKey);
    unique.push(txn);
  }

  return unique;
}

/**
 * Pass 1: Detect statement type
 */
async function detectStatementType(
  provider: LLMProvider,
  baseUrl: string,
  model: string,
  text: string,
): Promise<TypeDetectionResult> {
  const client = getBrowserClient(provider);
  const detectionText = getTextForDetection(text, 3000);
  const prompt = TYPE_DETECTION_PROMPT + detectionText + "\n---\n\nAnalyze and return JSON:";

  try {
    const raw = await client.generate(baseUrl, model, prompt, {
      temperature: 0.05,
    });
    return parseTypeDetectionResult(raw);
  } catch (err) {
    console.error('[Type Detection] Failed:', err);
    return { statementType: 'unknown', confidence: 0 };
  }
}

/**
 * Parse credit card statement using CC-specific prompt
 */
async function parseCCStatement(
  provider: LLMProvider,
  baseUrl: string,
  model: string,
  text: string,
  customClient?: LLMClient,
): Promise<{
  statement: CreditCardStatement | null;
  transactions: Transaction[];
  failedChunks: string[];
}> {
  const client = customClient || getBrowserClient(provider);
  const MAX_CHUNK_CHARS = 12000;
  
  let ccResult: CCExtractionResult | null = null;
  const allTransactions: Transaction[] = [];
  const failedChunks: string[] = [];

  const processChunkWithRetry = async (
    chunkText: string,
    depth: number = 0,
    chunkId: string
  ): Promise<void> => {
    const MAX_DEPTH = 2;
    const prompt = CC_EXTRACTION_PROMPT + chunkText + "\n---\n\nExtract as JSON:";

    try {
      const raw = await client.generate(baseUrl, model, prompt, {
        temperature: 0.05,
      });

      const parsed = parseCCExtractionResult(raw);
      if (parsed) {
        // Keep statement info from first successful parse
        if (!ccResult && validateCCExtractionResult(parsed)) {
          ccResult = parsed;
        }

        // Accumulate transactions
        if (Array.isArray(parsed.transactions)) {
          const otherCategory = Category.fromId(Category.DEFAULT_ID)!;
          const billsCategory = Category.fromId('bills')!;
          const settingsCurrency = useSettingsStore.getState().currency;

          const resolveCurrency = (code: string | undefined, fallback: Currency): Currency => {
            const normalizedCode = String(code || '').trim().toUpperCase();
            if (!normalizedCode) return fallback;
            return getCurrencyByCode(normalizedCode) || fallback;
          };

          const txns = parsed.transactions.map((t) => {
            // Determine direction based on transaction type
            // credit = money coming in, debit = money going out
            let txnType: TransactionType;

            if (t.transactionType === 'payment' || t.transactionType === 'refund' || t.transactionType === 'cashback') {
              txnType = TransactionType.Credit;
            } else {
              txnType = TransactionType.Debit;
            }

            // Determine category - CC payments go to bills
            const category = isCCPayment(t.description, txnType) ? billsCategory : otherCategory;

            // Determine transaction currency details
            const localCurrency = resolveCurrency(t.localCurrency, settingsCurrency);
            const originalCurrencyCode = String(t.originalCurrency || '').trim().toUpperCase();
            const originalCurrency = originalCurrencyCode
              ? getCurrencyByCode(originalCurrencyCode)
              : undefined;
            const isInternational = typeof t.isInternationalTransaction === 'boolean'
              ? t.isInternationalTransaction
              : Boolean(originalCurrencyCode || t.originalAmount !== undefined);

            return new Transaction(
              uuidv4(),
              new Date(t.date),
              t.description,
              Math.abs(t.amount),
              txnType,
              category,
              undefined, // balance
              undefined, // merchant
              t.description, // originalText
              undefined, // budgetMonth
              undefined, // categoryConfidence
              undefined, // needsReview
              undefined, // categorizedBy
              SourceType.CreditCard,
              undefined, // statementId
              ccResult?.statement.cardIssuer,
              ccResult?.statement.cardLastFour,
              t.cardHolder,
              localCurrency,
              originalCurrency,
              t.originalAmount,
              isInternational,
            );
          }).filter((t) => !isNaN(t.date.getTime()) && t.amount !== 0);

          allTransactions.push(...txns);
        }
      } else {
         throw new Error("Invalid JSON response");
      }
    } catch (err) {
      console.error(`[CC Parse] Chunk ${chunkId} failed (depth ${depth}):`, err);

      if (depth < MAX_DEPTH && chunkText.length > 500) {
        debugLog(`[CC Parse] Retrying chunk ${chunkId} by splitting...`);
        const midpoint = Math.floor(chunkText.length / 2);
        const splitIndex = chunkText.lastIndexOf('\n', midpoint);
        const safeSplitIndex = splitIndex > 0 ? splitIndex : midpoint;

        const part1 = chunkText.slice(0, safeSplitIndex);
        const part2 = chunkText.slice(safeSplitIndex);

        await processChunkWithRetry(part1, depth + 1, `${chunkId}.1`);
        await processChunkWithRetry(part2, depth + 1, `${chunkId}.2`);
      } else {
        debugLog(`[CC Parse] Chunk ${chunkId} permanently failed.`);
        failedChunks.push(`Chunk ${chunkId} (${chunkText.slice(0, 30)}...)`);
      }
    }
  };

  const initialChunks = splitTextIntoChunks(text, MAX_CHUNK_CHARS);

  for (let i = 0; i < initialChunks.length; i++) {
    await processChunkWithRetry(initialChunks[i], 0, `${i + 1}`);
  }

  // Deduplicate only with stronger row-level evidence from statement text.
  const uniqueTransactions = dedupeCCTransactionsWithAnchors(allTransactions, text);

  // Classify CC payments - update category to 'bills'
  const billsCategory = Category.fromId('bills')!;
  for (const txn of uniqueTransactions) {
    if (isCCPayment(txn.description, txn.type)) {
      txn.category = billsCategory;
    }
  }

  // Build CreditCardStatement object
  let ccStatement: CreditCardStatement | null = null;
  const finalCCResult = ccResult as CCExtractionResult | null;
  if (finalCCResult) {
    const stmt = finalCCResult.statement;
    ccStatement = createCreditCardStatement({
      fileName: '', // Will be set by caller
      parseDate: new Date(),
      cardLastFour: stmt.cardLastFour,
      cardIssuer: stmt.cardIssuer,
      cardHolder: stmt.cardHolder,
      statementPeriod: {
        start: new Date(stmt.statementPeriodStart),
        end: new Date(stmt.statementPeriodEnd),
      },
      statementDate: new Date(stmt.statementDate),
      paymentDueDate: new Date(stmt.paymentDueDate),
      totalDue: stmt.totalDue,
      minimumDue: stmt.minimumDue,
      creditLimit: stmt.creditLimit,
      availableCredit: stmt.availableCredit,
      previousBalance: stmt.previousBalance,
      paymentsReceived: stmt.paymentsReceived,
      purchasesAndCharges: stmt.purchasesAndCharges,
      interestCharged: stmt.interestCharged,
      lateFee: stmt.lateFee,
      otherCharges: stmt.otherCharges,
      addonCards: stmt.addonCards,
      // New fields
      isPaid: false,
      apr: stmt.apr,
      monthlyInterestRate: stmt.monthlyInterestRate,
      minimumPaymentPercent: stmt.minimumPaymentPercent,
      minimumPaymentFloor: stmt.minimumPaymentFloor,
      cashbackEarned: stmt.cashbackEarned,
      rewardPoints: stmt.rewardPoints ? {
        openingBalance: stmt.rewardPoints.openingBalance,
        earned: stmt.rewardPoints.earned,
        redeemed: stmt.rewardPoints.redeemed,
        expired: stmt.rewardPoints.expired,
        closingBalance: stmt.rewardPoints.closingBalance,
        expiringNext: stmt.rewardPoints.expiringNext,
        expiringNextDate: stmt.rewardPoints.expiringNextDate
          ? new Date(stmt.rewardPoints.expiringNextDate)
          : undefined,
      } : undefined,
    });
  }

  return { statement: ccStatement, transactions: uniqueTransactions, failedChunks };
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
  ccStatement?: CreditCardStatement;
  verification?: VerificationReport;
}

/**
 * Parse any file with two-pass approach (type detection + extraction)
 */
export async function parseWithLLMExtended(
  file: File,
  onProgress?: (status: string) => void,
  password?: string,
): Promise<ExtendedParseResult> {
  const { provider, url, model } = getLLMSettings();
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

  const selectedModel = await resolveModelOrThrow(provider, url, model ?? undefined);

  // 2 — Pass 1: Detect statement type
  onProgress?.("Detecting statement type...");
  const typeResult = await detectStatementType(provider, url, selectedModel, rawText);
  debugLog('[Parser] Type detection result:', typeResult);

  // Determine format
  let format: "pdf" | "csv" | "xlsx" | "xls" = "pdf";
  if (ext.endsWith(".csv")) format = "csv";
  else if (ext.endsWith(".xlsx")) format = "xlsx";
  else if (ext.endsWith(".xls")) format = "xls";

  // 3 — Pass 2: Parse based on type
  let transactions: Transaction[];
  let currency: Currency;
  let ccStatement: CreditCardStatement | undefined;
  let verificationReport: VerificationReport | undefined;
  let failedChunks: string[] = [];

  const settingsCurrency = useSettingsStore.getState().currency;

  if (typeResult.statementType === 'credit_card' && typeResult.confidence >= 0.5) {
    // Credit card statement
    onProgress?.("Parsing credit card statement...");

    const ccResult = await parseCCStatement(provider, url, selectedModel, rawText);
    transactions = ccResult.transactions;
    ccStatement = ccResult.statement ?? undefined;
    failedChunks = ccResult.failedChunks;

    // Prefer detected local currency from CC transactions; fallback to user settings currency.
    currency = transactions.find((t) => t.localCurrency)?.localCurrency || settingsCurrency;

    if (ccStatement) {
      ccStatement.fileName = file.name;
    }
  } else {
    // Bank statement (or unknown - default to bank)
    onProgress?.("Parsing bank statement...");

    const result = await parseLLMDirect(provider, url, selectedModel, rawText);
    failedChunks = result.failedChunks;

    if (!result.transactions || result.transactions.length === 0) {
      throw new Error("AI could not find any transactions in the document.");
    }

    // Run verification engine
    onProgress?.("Verifying parsed transactions...");
    const parsedTransactions: ParsedTransaction[] = result.transactions.map((t) => ({
      date: t.date as string,
      description: t.description as string,
      amount: Math.abs(t.amount as number),
      type: (t.type === 'credit' ? 'credit' : 'debit') as 'credit' | 'debit',
      currency: result.currency?.code,
    }));

    const meta: StatementMeta = {
      openingBalance: result.openingBalance,
      closingBalance: result.closingBalance,
      currency: result.currency?.code,
    };

    verificationReport = verifyStatement(rawText, parsedTransactions, meta);

    debugLog('[Verification] Report:', {
      verified: verificationReport.verified.length,
      rejected: verificationReport.rejected.length,
      duplicates: verificationReport.duplicates.length,
      reconciliation: verificationReport.reconciliation,
      overallConfidence: verificationReport.overallConfidence,
    });

    // Enforce strict reconciliation only when both balances are present.
    const hasBalanceInputs =
      meta.openingBalance !== undefined && meta.closingBalance !== undefined;

    if (!hasBalanceInputs) {
      debugLog(
        '[Verification] Skipping strict reconciliation (missing opening/closing balance)'
      );
    } else if (!verificationReport.reconciliation.passed) {
      const diff = verificationReport.reconciliation.difference?.toFixed(2) ?? 'unknown';
      throw new Error(
        `Statement reconciliation failed. Opening + Credits - Debits ≠ Closing. Difference: ${diff}. ` +
        `Please try re-uploading or check statement quality.`
      );
    }

    const otherCategory = Category.fromId(Category.DEFAULT_ID)!;
    // Use verified transactions only
    transactions = verificationReport.verified.map((t) => new Transaction(
      uuidv4(),
      new Date(t.date),
      t.description,
      Math.abs(t.amount),
      t.type as TransactionType,
      otherCategory,
      undefined, // balance
      undefined, // merchant
      t.description, // originalText
      undefined, // budgetMonth
      undefined, // categoryConfidence
      undefined, // needsReview
      undefined, // categorizedBy
      SourceType.Bank,
    )).filter((t) => !isNaN(t.date.getTime()) && t.amount !== 0);

    // Resolve currency: LLM > Regex > Settings
    let resolvedCode = result.currency?.code;
    if (!resolvedCode) {
      resolvedCode = detectCurrencyFromText(rawText) || settingsCurrency.code;
    }
    
    currency = getCurrencyByCode(resolvedCode) || settingsCurrency;
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
    statementType: typeResult.statementType === 'credit_card' ? 'credit_card' : 'bank',
    ccStatement,
    verification: verificationReport,
  };
}

