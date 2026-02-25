import { Transaction, ParsedStatement, Currency, LLMStatus } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { getBrowserClient } from "@/lib/llm/index";
import { LLMProvider } from "@/lib/llm/types";
import { debugLog } from "@/lib/utils/debug";
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

/* ============================================================
   LLM-POWERED PARSER
   Works with PDF, CSV, and XLS files.
   Sends extracted text to local Ollama for transaction parsing.
   ============================================================ */

function getLLMSettings() {
  const { llmProvider, ollamaUrl, llmModel } = useSettingsStore.getState();
  return { provider: llmProvider, url: ollamaUrl, model: llmModel };
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
 * Extract raw text from a PDF file using pdfjs-dist (runs in browser).
 * Preserves spatial layout for better LLM comprehension.
 */
export async function extractTextFromPDF(
  file: File,
  password?: string,
): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const arrayBuffer = await file.arrayBuffer();

  // Build document options with optional password
  const docOptions: { data: ArrayBuffer; password?: string } = {
    data: arrayBuffer,
  };
  if (password) {
    docOptions.password = password;
  }

  const pdf = await pdfjsLib.getDocument(docOptions).promise;

  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    // Preserve spatial layout: group by Y, sort by X
    const items = textContent.items
      .filter((item): item is { str: string; transform: number[] } =>
        'str' in item && typeof item.str === 'string' && item.str.trim().length > 0
      )
      .map((item) => ({
        text: item.str.trim(),
        x: Math.round(item.transform[4]),
        y: Math.round(item.transform[5]),
      }));

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

  return fullText;
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

  const client = getBrowserClient(provider);

  // Resolve model
  let selectedModel = model ?? undefined;
  if (!selectedModel) {
    const models = await client.listModels(url);
    selectedModel = models[0];
  }
  if (!selectedModel) {
    throw new Error(
      "No AI model available. Pull a model first (e.g. ollama pull llama3.2)",
    );
  }

  const result = await parseLLMDirect(provider, url, selectedModel, rawText);

  if (!result.transactions || result.transactions.length === 0) {
    throw new Error("AI could not find any transactions in the document.");
  }

  onProgress?.(`Found ${result.transactions.length} transactions!`);

  // 3 — Convert to Transaction objects
  const transactions: Transaction[] = (
    result.transactions as {
      date: string;
      description: string;
      amount: number;
      type: string;
    }[]
  )
    .map(
      (t) => ({
        id: uuidv4(),
        date: new Date(t.date),
        description: t.description,
        amount: t.type === "expense" ? -Math.abs(t.amount) : Math.abs(t.amount),
        category: "other",
        type: t.type as "income" | "expense",
        originalText: t.description,
      }),
    )
    .filter((t: Transaction) => !isNaN(t.date.getTime()) && t.amount !== 0);

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
  const llmUrl = url ?? settings.ollamaUrl;
  const llmProvider = provider ?? settings.llmProvider;
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
   - type: "expense" for debits/withdrawals/payments/money-out, "income" for credits/deposits/transfers-in/money-in
5. Look for these clues to determine type:
   - Separate "Debit" and "Credit" columns → debit = expense, credit = income
   - Keywords: DEBIT/DR/WITHDRAWAL/PAID/SENT = expense; CREDIT/CR/DEPOSIT/RECEIVED/REFUND = income
   - Negative amounts or amounts in parentheses = expense
   - Column headers like "Money Out" vs "Money In"
6. Do NOT include opening/closing balance rows, interest calculations, or summary rows — only actual transactions.
7. Do NOT hallucinate transactions. Only extract what is actually in the text.
8. Output ONLY valid JSON — no markdown fences, no explanation, no extra text.

REQUIRED JSON FORMAT:
{"currency":{"code":"INR","symbol":"₹","name":"Indian Rupee"},"transactions":[{"date":"2024-01-15","description":"Amazon Purchase","amount":500.00,"type":"expense"},{"date":"2024-01-20","description":"Salary Credit","amount":50000.00,"type":"income"}]}

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

async function parseLLMDirect(
  provider: LLMProvider,
  baseUrl: string,
  model: string,
  text: string,
): Promise<{
  currency: Record<string, string> | null;
  transactions: Record<string, unknown>[];
}> {
  const MAX_CHUNK_CHARS = 12000;
  const chunks = splitTextIntoChunks(text, MAX_CHUNK_CHARS);
  const client = getBrowserClient(provider);

  const allTransactions: Record<string, unknown>[] = [];
  let currency: Record<string, string> | null = null;

  for (let i = 0; i < chunks.length; i++) {
    const prompt =
      PARSE_PROMPT + chunks[i] + "\n---\n\nExtract all transactions as JSON:";

    let raw: string;
    try {
      raw = await client.generate(baseUrl, model, prompt, {
        temperature: 0.05,
      });
    } catch (err) {
      console.error(`[LLM Parse] Chunk ${i + 1} failed:`, err);
      continue;
    }

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
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const validTransactions = allTransactions.filter(
    (t: Record<string, unknown>) => {
      if (!t.date || !t.description || typeof t.amount !== "number")
        return false;
      if (t.type !== "income" && t.type !== "expense") return false;
      if (t.amount === 0) return false;

      const key = `${t.date}|${String(t.description).substring(0, 30)}|${Math.abs(t.amount as number)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  );

  const normalizedTransactions = validTransactions.map((t) => ({
    ...t,
    amount:
      t.type === "expense"
        ? -Math.abs(t.amount as number)
        : Math.abs(t.amount as number),
  }));

  return { currency, transactions: normalizedTransactions };
}

/**
 * Build a context string from parsed transactions for use in chat.
 */
export function buildChatContext(
  transactions: Transaction[],
  currency: Currency,
  fileName: string,
): string {
  if (transactions.length === 0) return "No transactions loaded.";

  const income = transactions.filter((t) => t.type === "income");
  const expenses = transactions.filter((t) => t.type === "expense");

  const totalIncome = income.reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalExpenses = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);

  const dates = transactions
    .map((t) => new Date(t.date))
    .filter((d) => !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  let ctx = `Bank Statement — "${fileName}"
Period: ${fmt(dates[0])} to ${fmt(dates[dates.length - 1])}
Currency: ${currency.name} (${currency.symbol}) [${currency.code}]
Total Transactions: ${transactions.length}
Total Income: ${currency.symbol}${totalIncome.toLocaleString()}
Total Expenses: ${currency.symbol}${totalExpenses.toLocaleString()}
Net: ${currency.symbol}${(totalIncome - totalExpenses).toLocaleString()}

All Transactions:
`;

  for (const t of transactions) {
    const sign = t.type === "income" ? "+" : "-";
    ctx += `${fmt(new Date(t.date))} | ${t.description} | ${sign}${currency.symbol}${Math.abs(t.amount).toLocaleString()} | ${t.type} | category: ${t.category}\n`;
  }

  return ctx;
}

/* ── Two-Pass Parsing for Statement Type Detection ─────────── */

const CC_PAYMENT_KEYWORDS = [
  'credit card', 'cc payment', 'card payment',
  'hdfc card', 'icici card', 'axis card', 'sbi card',
  'kotak card', 'citi card', 'amex card', 'idfc card',
];

const CC_ISSUERS = [
  'hdfc', 'icici', 'axis', 'sbi', 'kotak', 'citi',
  'amex', 'idfc', 'au bank', 'bob', 'canara', 'pnb',
];

/**
 * Detect if a transaction is a credit card payment
 */
function isCCPayment(description: string): boolean {
  const lower = description.toLowerCase();

  // Check for CC payment keywords
  if (CC_PAYMENT_KEYWORDS.some(kw => lower.includes(kw))) {
    return true;
  }

  // Check for issuer + card pattern
  if (CC_ISSUERS.some(issuer => lower.includes(issuer)) && lower.includes('card')) {
    return true;
  }

  return false;
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
): Promise<{
  statement: CreditCardStatement | null;
  transactions: Transaction[];
}> {
  const client = getBrowserClient(provider);
  const MAX_CHUNK_CHARS = 12000;
  const chunks = splitTextIntoChunks(text, MAX_CHUNK_CHARS);

  let ccResult: CCExtractionResult | null = null;
  const allTransactions: Transaction[] = [];

  // First chunk: extract statement info + transactions
  // Subsequent chunks: just extract transactions
  for (let i = 0; i < chunks.length; i++) {
    const prompt = CC_EXTRACTION_PROMPT + chunks[i] + "\n---\n\nExtract as JSON:";

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
          const txns = parsed.transactions.map((t) => ({
            id: uuidv4(),
            date: new Date(t.date),
            description: t.description,
            amount: t.transactionType === 'payment' || t.transactionType === 'refund'
              ? Math.abs(t.amount)
              : -Math.abs(t.amount),
            category: 'other',
            type: (t.transactionType === 'payment' || t.transactionType === 'refund'
              ? 'income'
              : 'expense') as 'income' | 'expense',
            originalText: t.description,
            sourceType: 'credit_card' as const,
            cardIssuer: ccResult?.statement.cardIssuer,
            cardLastFour: ccResult?.statement.cardLastFour,
            cardHolder: t.cardHolder,
            currency: t.currency,
            originalAmount: t.originalAmount,
            transactionType: t.transactionType,
          })).filter((t) => !isNaN(t.date.getTime()) && t.amount !== 0);

          allTransactions.push(...txns);
        }
      }
    } catch (err) {
      console.error(`[CC Parse] Chunk ${i + 1} failed:`, err);
    }
  }

  // Deduplicate transactions
  const seen = new Set<string>();
  const uniqueTransactions = allTransactions.filter((t) => {
    const key = `${t.date.toISOString()}|${t.description.substring(0, 30)}|${Math.abs(t.amount)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Classify CC payments as transfers
  for (const txn of uniqueTransactions) {
    if (isCCPayment(txn.description)) {
      txn.type = 'transfer';
    }
  }

  // Build CreditCardStatement object
  let ccStatement: CreditCardStatement | null = null;
  if (ccResult) {
    const stmt = ccResult.statement;
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
    });
  }

  return { statement: ccStatement, transactions: uniqueTransactions };
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

  // 2 — Pass 1: Detect statement type
  onProgress?.("Detecting statement type...");
  const typeResult = await detectStatementType(provider, url, model || '', rawText);
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

  if (typeResult.statementType === 'credit_card' && typeResult.confidence >= 0.5) {
    // Credit card statement
    onProgress?.("Parsing credit card statement...");

    const ccResult = await parseCCStatement(provider, url, model || '', rawText);
    transactions = ccResult.transactions;
    ccStatement = ccResult.statement ?? undefined;

    // Default currency for CC statements in India
    currency = {
      code: 'INR',
      symbol: '₹',
      name: 'Indian Rupee',
    };

    if (ccStatement) {
      ccStatement.fileName = file.name;
    }
  } else {
    // Bank statement (or unknown - default to bank)
    onProgress?.("Parsing bank statement...");

    const result = await parseLLMDirect(provider, url, model || '', rawText);

    if (!result.transactions || result.transactions.length === 0) {
      throw new Error("AI could not find any transactions in the document.");
    }

    transactions = result.transactions.map((t) => ({
      id: uuidv4(),
      date: new Date(t.date as string),
      description: t.description as string,
      amount: t.amount as number,
      category: 'other',
      type: t.type as 'income' | 'expense',
      originalText: t.description as string,
      sourceType: 'bank' as const,
    })).filter((t) => !isNaN(t.date.getTime()) && t.amount !== 0);

    currency = {
      code: result.currency?.code || "INR",
      symbol: result.currency?.symbol || "₹",
      name: result.currency?.name || "Indian Rupee",
    };
  }

  onProgress?.(`Found ${transactions.length} transactions!`);

  return {
    statement: {
      transactions,
      format,
      fileName: file.name,
      parseDate: new Date(),
    },
    currency,
    rawText,
    statementType: typeResult.statementType === 'credit_card' ? 'credit_card' : 'bank',
    ccStatement,
  };
}
