import { ParsedStatement, Currency, TransactionType, Transaction, Category } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { extractDateFromText } from "./dateParser";
import { detectCurrencyFromText } from "./currencyDetector";
import { debugLog, debugWarn } from "@/lib/utils/debug";

/* ============================================================
   UNIVERSAL PDF PARSER — Column-Position-Based

   Strategy:
   1. Extract text items with X/Y coordinates from each page
   2. Detect column headers → map X positions to Debit/Credit/Balance
   3. Parse data rows using column alignment for 100% correct type
   4. Validate with running-balance cross-check
   5. Fallback: text-based heuristics + balance tracking
   ============================================================ */

/* ============================================================
   Password Error Detection
   pdfjs-dist throws PasswordException for encrypted PDFs
   ============================================================ */

export function isPasswordError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const err = error as Record<string, unknown>;

  // pdfjs-dist PasswordException has name 'PasswordException'
  if (err.name === "PasswordException") return true;

  // pdfjs-dist error codes: 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD
  if (err.code === 1 || err.code === 2) return true;

  // Check for specific pdfjs password-related messages only
  if (typeof err.message === "string") {
    const msg = err.message.toLowerCase();
    // Only match actual password errors from pdfjs, not generic messages
    if (msg.includes("no password given") || msg.includes("incorrect password")) {
      return true;
    }
  }

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

export interface PDFParseResult {
  statement: ParsedStatement;
  detectedCurrency: Currency | null;
  rawText: string;
}

// ── Internal types ──

interface PdfItem {
  text: string;
  x: number;
  y: number;
}

interface PdfLine {
  y: number;
  items: PdfItem[];
}

type ColType =
  | "date"
  | "desc"
  | "debit"
  | "credit"
  | "amount"
  | "balance"
  | "type";

interface ColDef {
  type: ColType;
  x: number; // left-edge X of column header
  xEnd: number; // rough right edge
}

// ── Column header keyword lists ──

const COL_KEYWORDS: Record<ColType, string[]> = {
  date: [
    "date",
    "txn date",
    "transaction date",
    "value date",
    "posting date",
    "book date",
    "txn dt",
  ],
  desc: [
    "description",
    "narration",
    "particulars",
    "details",
    "transaction details",
    "memo",
  ],
  debit: [
    "debit",
    "dr",
    "withdrawal",
    "withdrawals",
    "money out",
    "debit amount",
    "debit(dr)",
    "spent",
    "dr.",
  ],
  credit: [
    "credit",
    "cr",
    "deposit",
    "deposits",
    "money in",
    "credit amount",
    "credit(cr)",
    "received",
    "cr.",
  ],
  amount: ["amount", "transaction amount", "txn amount", "txn amt"],
  balance: [
    "balance",
    "closing balance",
    "running balance",
    "available balance",
    "closing bal",
    "bal",
  ],
  type: ["type", "transaction type", "txn type", "cr/dr", "dr/cr"],
};

function classifyHeaderItem(text: string): ColType | null {
  const norm = text
    .toLowerCase()
    .replace(/[^a-z0-9\s/().]/g, "")
    .trim();
  if (!norm || norm.length < 2) return null;
  for (const [type, keywords] of Object.entries(COL_KEYWORDS)) {
    if (keywords.some((kw) => norm === kw || norm.includes(kw))) {
      return type as ColType;
    }
  }
  return null;
}

// ── Amount parsing ──

function parseAmount(s: string): number | null {
  let cleaned = s.replace(/[₹$€£¥₺₽₩₪₦₱₫৳฿\s]/g, "").trim();
  // Remove trailing cr/cr. for numeric parsing (we detect it separately for type)
  cleaned = cleaned.replace(/cr\.?$/i, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "--") return null;

  const isNeg =
    (cleaned.startsWith("(") && cleaned.endsWith(")")) ||
    cleaned.startsWith("-");
  if (cleaned.startsWith("(") && cleaned.endsWith(")"))
    cleaned = cleaned.slice(1, -1);
  if (cleaned.startsWith("-")) cleaned = cleaned.slice(1);

  // Handle decimal separators
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  if (lastComma > lastDot && lastComma > 0) {
    const after = cleaned.substring(lastComma + 1);
    if (after.length <= 2 && /^\d+$/.test(after)) {
      // European: comma is decimal separator
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      // Indian / other: comma is thousands separator
      cleaned = cleaned.replace(/,/g, "");
    }
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }

  const num = parseFloat(cleaned);
  if (isNaN(num) || num === 0) return null;
  return isNeg ? -num : num;
}

/**
 * Detect if amount string has "cr" suffix (indicates credit transaction).
 * Returns true if "cr" or "cr." is found at the end of the string.
 */
function hasCreditSuffix(s: string): boolean {
  return /\bcr\.?\s*$/i.test(s.trim());
}

function isNumericItem(text: string): boolean {
  const cleaned = text.replace(/[₹$€£¥₺₽₩₪₦₱₫৳฿\s,.()\-]/g, "");
  return /^\d+$/.test(cleaned) && cleaned.length > 0;
}

// ── Main entry point ──

export async function parsePDF(
  file: File,
  password?: string,
): Promise<PDFParseResult> {
  try {
    const pdfjsLib = await import("pdfjs-dist");

    // DEBUG: Log pdfjs library info
    console.log('[pdfParser] pdfjsLib version:', pdfjsLib.version);
    console.log('[pdfParser] pdfjsLib.getDocument:', typeof pdfjsLib.getDocument);
    console.log('[pdfParser] pdfjsLib keys:', Object.keys(pdfjsLib).slice(0, 20).join(', '));

    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

    const arrayBuffer = await file.arrayBuffer();

    // Build document options with optional password
    console.log('[pdfParser] Received password parameter:', password ? `"${password}" (${password.length} chars)` : '(undefined/empty)');
    const docOptions: { data: ArrayBuffer; password?: string } = {
      data: arrayBuffer,
    };
    if (password) {
      docOptions.password = password;
    }

    const pdf = await pdfjsLib.getDocument(docOptions).promise;

    const allLines: PdfLine[] = [];
    let fullText = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();

      const items: PdfItem[] = textContent.items
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((item: any) => item.str && item.str.trim().length > 0)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((item: any) => ({
          text: item.str.trim(),
          x: Math.round(item.transform[4]),
          y: Math.round(item.transform[5]),
        }));

      // Group by Y (same line within 3px)
      const pageLines: PdfLine[] = [];
      for (const item of items) {
        const existing = pageLines.find((l) => Math.abs(l.y - item.y) < 3);
        if (existing) {
          existing.items.push(item);
        } else {
          pageLines.push({ y: item.y, items: [item] });
        }
      }

      // Sort: top→bottom, items left→right
      pageLines.sort((a, b) => b.y - a.y);
      for (const line of pageLines) {
        line.items.sort((a, b) => a.x - b.x);
        fullText += line.items.map((i) => i.text).join("  ") + "\n";
      }
      fullText += "\n";
      allLines.push(...pageLines);
    }

    const detectedCurrency = detectCurrencyFromText(fullText);

    // === Strategy 1: Column-position parsing (most reliable) ===
    let transactions = columnBasedParse(allLines);
    debugLog(`[PDF] Column-based: ${transactions.length} transactions`);

    // === Strategy 2: Enhanced text fallback with balance tracking ===
    if (transactions.length < 3) {
      const fallbackTxns = textBasedParse(allLines);
      debugLog(`[PDF] Text-based: ${fallbackTxns.length} transactions`);
      if (fallbackTxns.length > transactions.length) {
        transactions = fallbackTxns;
      }
    }

    // === Balance validation: correct any mis-classified transactions ===
    transactions = validateWithBalance(transactions);

    if (transactions.length < 3) {
      debugWarn(
        "[PDF] Only found",
        transactions.length,
        "transactions. Consider using AI parsing.",
      );
    }

    debugLog(`[PDF] Final: ${transactions.length} transactions`);

    return {
      statement: {
        transactions,
        format: "pdf",
        fileName: file.name,
        parseDate: new Date(),
      },
      detectedCurrency,
      rawText: fullText,
    };
  } catch (error) {
    console.error("Error parsing PDF:", error);

    // Check if this is a password error
    if (isPasswordError(error)) {
      const err = error as Record<string, unknown>;
      const code = typeof err.code === "number" ? err.code : 1;
      throw new PDFPasswordError("PDF is password protected", code);
    }

    // Re-throw other errors as generic parse failure
    throw new Error("Failed to parse PDF file");
  }
}

/* ================================================================
   Strategy 1: COLUMN-BASED PARSING
   Finds the header row, maps column positions, then uses
   X-coordinate alignment to correctly assign each amount
   to the right column (Debit / Credit / Balance).
   ================================================================ */

function findHeaderRow(
  lines: PdfLine[],
): { columns: ColDef[]; headerIdx: number } | null {
  // Scan first 60 lines for a header row
  for (let i = 0; i < Math.min(lines.length, 60); i++) {
    const line = lines[i];
    if (line.items.length < 2) continue;

    const classified: { item: PdfItem; type: ColType }[] = [];
    for (const item of line.items) {
      const type = classifyHeaderItem(item.text);
      if (type) classified.push({ item, type });
    }

    // Need at least: date + (debit OR credit OR amount)
    const types = new Set(classified.map((c) => c.type));
    const hasDate = types.has("date");
    const hasMoneyCol =
      types.has("debit") || types.has("credit") || types.has("amount");

    if (hasDate && hasMoneyCol && classified.length >= 2) {
      const columns: ColDef[] = classified.map((c) => ({
        type: c.type,
        x: c.item.x,
        xEnd: c.item.x + c.item.text.length * 6,
      }));

      debugLog(
        `[PDF] Header at line ${i}:`,
        columns.map((c) => `${c.type}@x=${c.x}`).join(", "),
      );
      return { columns, headerIdx: i };
    }
  }
  return null;
}

function assignToColumn(
  x: number,
  columns: ColDef[],
  targetTypes: ColType[],
): ColType | null {
  const relevant = columns.filter((c) => targetTypes.includes(c.type));
  if (relevant.length === 0) return null;

  let best: ColDef | null = null;
  let bestDist = Infinity;

  for (const col of relevant) {
    const center = (col.x + col.xEnd) / 2;
    const dist = Math.abs(x - center);
    // Items within the column range get priority
    const withinRange = x >= col.x - 40 && x <= col.xEnd + 40;
    const effectiveDist = withinRange ? dist * 0.5 : dist;

    if (effectiveDist < bestDist) {
      bestDist = effectiveDist;
      best = col;
    }
  }

  // Max tolerance: 100px
  if (best && bestDist <= 100) return best.type;
  return null;
}

function columnBasedParse(lines: PdfLine[]): Transaction[] {
  const headerInfo = findHeaderRow(lines);
  if (!headerInfo) return [];

  const { columns, headerIdx } = headerInfo;
  const hasDebit = columns.some((c) => c.type === "debit");
  const hasCredit = columns.some((c) => c.type === "credit");
  const hasAmount = columns.some((c) => c.type === "amount");
  const hasType = columns.some((c) => c.type === "type");

  const transactions: Transaction[] = [];
  const seen = new Set<string>();

  let currentTxn: {
    date: Date;
    descParts: string[];
    debit: number | null;
    credit: number | null;
    amount: number | null;
    amountIsCredit: boolean;
    balance: number | null;
    typeIndicator: string;
    lineText: string;
  } | null = null;

  const finalizeTxn = () => {
    if (!currentTxn) return;

    let finalAmount: number | null = null;
    let type: TransactionType = TransactionType.Debit;

    if (hasDebit && hasCredit) {
      // Separate debit/credit columns — most reliable
      if (currentTxn.debit !== null && currentTxn.debit > 0) {
        finalAmount = currentTxn.debit;
        type = TransactionType.Debit;
      } else if (currentTxn.credit !== null && currentTxn.credit > 0) {
        finalAmount = currentTxn.credit;
        type = TransactionType.Credit;
      }
    } else if (hasAmount && currentTxn.amount !== null) {
      if (hasType) {
        const ti = currentTxn.typeIndicator.toLowerCase();
        if (
          ti.includes("dr") ||
          ti.includes("debit") ||
          ti.includes("withdrawal")
        ) {
          finalAmount = Math.abs(currentTxn.amount);
          type = TransactionType.Debit;
        } else if (
          ti.includes("cr") ||
          ti.includes("credit") ||
          ti.includes("deposit")
        ) {
          finalAmount = Math.abs(currentTxn.amount);
          type = TransactionType.Credit;
        } else {
          finalAmount = Math.abs(currentTxn.amount);
          type = currentTxn.amount >= 0 ? TransactionType.Credit : TransactionType.Debit;
        }
      } else {
        // Single amount column, no type column — check for "cr" suffix or fall back to sign
        finalAmount = Math.abs(currentTxn.amount);
        if (currentTxn.amountIsCredit) {
          type = TransactionType.Credit;
        } else {
          type = currentTxn.amount >= 0 ? TransactionType.Credit : TransactionType.Debit;
        }
      }
    } else if (hasDebit && currentTxn.debit !== null && currentTxn.debit > 0) {
      // Only debit column exists
      finalAmount = currentTxn.debit;
      type = TransactionType.Debit;
    } else if (
      hasCredit &&
      currentTxn.credit !== null &&
      currentTxn.credit > 0
    ) {
      // Only credit column exists
      finalAmount = currentTxn.credit;
      type = TransactionType.Credit;
    }

    if (finalAmount === null || finalAmount === 0) return;

    const description =
      currentTxn.descParts.join(" ").replace(/\s+/g, " ").trim() ||
      "Transaction";

    const key = `${currentTxn.date.toISOString().slice(0, 10)}|${finalAmount.toFixed(2)}|${description.substring(0, 30)}`;
    if (seen.has(key)) return;
    seen.add(key);

    transactions.push(new Transaction(
      uuidv4(),
      currentTxn.date,
      description,
      finalAmount,
      type,
      Category.fromId("other")!,
      currentTxn.balance ?? undefined,
      undefined, // merchant
      currentTxn.lineText.substring(0, 200),
    ));
  };

  // Process each line after the header
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const lineText = line.items.map((it) => it.text).join("  ");

    // Skip lines that look like page headers/footers or summaries
    if (
      /\b(page|total|opening balance|closing balance|statement|account)\b/i.test(
        lineText,
      ) &&
      !extractDateFromText(lineText)
    ) {
      continue;
    }

    // Check if this line starts a new transaction (has a date)
    const date = extractDateFromText(lineText);

    if (date) {
      // Finalize previous transaction
      finalizeTxn();

      // Start new transaction
      currentTxn = {
        date,
        descParts: [],
        debit: null,
        credit: null,
        amount: null,
        amountIsCredit: false,
        balance: null,
        typeIndicator: "",
        lineText,
      };

      // Process items in this line
      for (const item of line.items) {
        if (isNumericItem(item.text)) {
          const amt = parseAmount(item.text);
          if (amt !== null) {
            const colType = assignToColumn(item.x, columns, [
              "debit",
              "credit",
              "amount",
              "balance",
            ]);
            switch (colType) {
              case "debit":
                currentTxn.debit = Math.abs(amt);
                break;
              case "credit":
                currentTxn.credit = Math.abs(amt);
                break;
              case "amount":
                currentTxn.amount = amt;
                currentTxn.amountIsCredit = hasCreditSuffix(item.text);
                break;
              case "balance":
                currentTxn.balance = amt;
                break;
              // If unassigned, ignore — might be a reference number
            }
          }
        } else {
          // Check for type indicator
          if (hasType) {
            const typeCol = assignToColumn(item.x, columns, ["type"]);
            if (typeCol === "type") {
              currentTxn.typeIndicator = item.text;
              continue;
            }
          }

          // Non-numeric, non-date: treat as description
          const itemDate = extractDateFromText(item.text);
          if (!itemDate) {
            currentTxn.descParts.push(item.text);
          }
        }
      }
    } else if (currentTxn) {
      // Continuation line (no date) — append to current transaction
      for (const item of line.items) {
        if (isNumericItem(item.text)) {
          const amt = parseAmount(item.text);
          if (amt !== null) {
            const colType = assignToColumn(item.x, columns, [
              "debit",
              "credit",
              "amount",
              "balance",
            ]);
            switch (colType) {
              case "debit":
                currentTxn.debit = Math.abs(amt);
                break;
              case "credit":
                currentTxn.credit = Math.abs(amt);
                break;
              case "amount":
                currentTxn.amount = amt;
                currentTxn.amountIsCredit = hasCreditSuffix(item.text);
                break;
              case "balance":
                currentTxn.balance = amt;
                break;
            }
          }
        } else {
          currentTxn.descParts.push(item.text);
        }
      }
      currentTxn.lineText += " " + lineText;
    }
  }

  // Finalize last transaction
  finalizeTxn();

  return transactions;
}

/* ================================================================
   Strategy 2: TEXT-BASED FALLBACK with balance tracking
   Used when no column headers are found. Extracts amounts from
   each line and uses balance changes to determine type.
   ================================================================ */

function textBasedParse(lines: PdfLine[]): Transaction[] {
  const transactions: Transaction[] = [];
  const seen = new Set<string>();

  // Collect raw entries: each starts with a date
  interface RawEntry {
    date: Date;
    text: string;
    amounts: number[];
  }

  const entries: RawEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i].items.map((it) => it.text).join("  ");
    const date = extractDateFromText(lineText);
    if (!date) continue;

    // Collect context lines until next date line
    let fullText = lineText;
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const nextText = lines[j].items.map((it) => it.text).join("  ");
      if (extractDateFromText(nextText)) break;
      fullText += " " + nextText;
    }

    // Extract all amounts
    const amountRegex = /(?:[₹$€£¥₺₽₩₪₦₱₫৳฿]\s*)?[\d,]+\.?\d*|\d+[.,]\d{2}/g;
    const matches = fullText.match(amountRegex) || [];
    const amounts: number[] = [];
    for (const m of matches) {
      const a = parseAmount(m);
      if (a !== null && Math.abs(a) >= 0.01) {
        amounts.push(Math.abs(a));
      }
    }

    if (amounts.length === 0) continue;
    entries.push({ date, text: fullText, amounts });
  }

  // ------- Try balance tracking -------
  // Assume the last amount on each line is the running balance
  if (entries.length >= 3) {
    let prevBalance: number | null = null;
    let balanceTrackingValid = true;

    // Validate: check that balance differences match transaction amounts
    for (let i = 0; i < Math.min(entries.length, 10); i++) {
      const entry = entries[i];
      if (entry.amounts.length < 2) {
        balanceTrackingValid = false;
        break;
      }
      const balance = entry.amounts[entry.amounts.length - 1];

      if (prevBalance !== null) {
        const diff = Math.abs(balance - prevBalance);
        const otherAmounts = entry.amounts.slice(0, -1);
        // The diff should roughly match one of the transaction amounts
        const hasMatch = otherAmounts.some(
          (a) => Math.abs(a - diff) < diff * 0.01 + 0.02,
        );
        if (!hasMatch && diff > 0.1) {
          balanceTrackingValid = false;
          break;
        }
      }
      prevBalance = balance;
    }

    if (balanceTrackingValid) {
      debugLog("[PDF] Using balance tracking for type detection");
      prevBalance = null;

      for (const entry of entries) {
        const balance = entry.amounts[entry.amounts.length - 1];

        if (prevBalance !== null) {
          const diff = balance - prevBalance;
          const type: TransactionType = diff >= 0 ? TransactionType.Credit : TransactionType.Debit;
          const txnAmount = Math.abs(diff);

          // Use matching non-balance amount if available
          const otherAmounts = entry.amounts.slice(0, -1);
          let finalAmount = txnAmount;
          const match = otherAmounts.find(
            (a) => Math.abs(a - txnAmount) < txnAmount * 0.01 + 0.02,
          );
          if (match) finalAmount = match;
          else if (otherAmounts.length > 0) finalAmount = otherAmounts[0];

          if (finalAmount < 0.01) {
            prevBalance = balance;
            continue;
          }

          const description = cleanDescription(entry.text);

          const key = `${entry.date.toISOString().slice(0, 10)}|${finalAmount.toFixed(2)}|${description.substring(0, 30)}`;
          if (!seen.has(key)) {
            seen.add(key);
            transactions.push(new Transaction(
              uuidv4(),
              entry.date,
              description,
              finalAmount,
              type,
              Category.fromId("other")!,
              balance,
              undefined, // merchant
              entry.text.substring(0, 200),
            ));
          }
        }

        prevBalance = balance;
      }

      if (transactions.length > 0) return transactions;
    }
  }

  // ------- Final fallback: keyword-based type detection -------
  debugLog("[PDF] Using keyword-based type detection");

  for (const entry of entries) {
    const creditPatterns =
      /\b(CREDIT|CR|CREDITED|DEPOSIT|RECEIVED|INCOME|REFUND|CASHBACK)\b/i;
    const debitPatterns =
      /\b(DEBIT|DR|DEBITED|WITHDRAW|WITHDRAWAL|PAID|PAYMENT|PURCHASE|SPENT|EXPENSE|SENT)\b/i;

    // Check for "cr" suffix on amounts (e.g., "50.00 cr")
    const hasCrSuffix = hasCreditSuffix(entry.text);
    const hasCredit = hasCrSuffix || creditPatterns.test(entry.text);
    const hasDebit = debitPatterns.test(entry.text);

    let type: TransactionType = TransactionType.Debit;
    if (hasCredit && !hasDebit) type = TransactionType.Credit;
    else if (hasDebit) type = TransactionType.Debit;

    // Select the transaction amount (not the balance)
    let amount: number;
    if (entry.amounts.length >= 3) {
      // Likely: [debit_or_credit_amount, ..., balance]
      // The first non-zero amount is usually the transaction amount
      amount = entry.amounts[0];
    } else if (entry.amounts.length === 2) {
      // [amount, balance] — first is the transaction amount
      amount = entry.amounts[0];
    } else {
      amount = entry.amounts[0];
    }

    if (amount < 0.01) continue;

    const description = cleanDescription(entry.text);
    const balance =
      entry.amounts.length >= 2
        ? entry.amounts[entry.amounts.length - 1]
        : undefined;

    const key = `${entry.date.toISOString().slice(0, 10)}|${amount.toFixed(2)}|${description.substring(0, 30)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    transactions.push(new Transaction(
      uuidv4(),
      entry.date,
      description,
      amount,
      type,
      Category.fromId("other")!,
      balance,
      undefined, // merchant
      entry.text.substring(0, 200),
    ));
  }

  return transactions;
}

function cleanDescription(text: string): string {
  let desc = text;
  // Remove dates
  desc = desc.replace(/\d{1,2}[-/\s.]\w{3,9}[-/\s.,]*\d{2,4}/g, "");
  desc = desc.replace(/\w{3,9}\s+\d{1,2},?\s*\d{2,4}/g, "");
  desc = desc.replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, "");
  desc = desc.replace(/\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/g, "");
  // Remove amounts
  desc = desc.replace(/[₹$€£¥₺₽₩₪₦₱₫৳฿]\s*[\d,]+\.?\d*/g, "");
  desc = desc.replace(/\b[\d,]+\.\d{2}\b/g, "");
  // Remove type keywords
  desc = desc.replace(/\b(CREDIT|DEBIT|CR|DR|CREDITED|DEBITED)\b/gi, "");
  // Remove noise
  desc = desc.replace(
    /\b(Transaction ID|UTR No\.?|Ref\.?\s*No\.?)\s*\S+/gi,
    "",
  );
  desc = desc.replace(/\d{2}:\d{2}\s*(am|pm|AM|PM)?/g, "");
  desc = desc.replace(/\s+/g, " ").trim();
  return desc || "Transaction";
}

/* ================================================================
   Balance Validation
   Uses running balance to cross-check and correct type assignments.
   If balance goes up → income, down → expense. This overrides
   any keyword-based guess.
   ================================================================ */

function validateWithBalance(transactions: Transaction[]): Transaction[] {
  if (transactions.length < 3) return transactions;

  // Only validate if we have enough balance data
  const withBalance = transactions.filter(
    (t) => t.balance !== undefined && t.balance !== null,
  );
  if (withBalance.length < transactions.length * 0.5) return transactions;

  let corrected = 0;
  const result = [...transactions];

  for (let i = 1; i < result.length; i++) {
    const prev = result[i - 1];
    const curr = result[i];

    if (
      prev.balance === undefined ||
      curr.balance === undefined ||
      prev.balance === null ||
      curr.balance === null
    ) {
      continue;
    }

    const balanceDiff = curr.balance - prev.balance;
    if (Math.abs(balanceDiff) < 0.01) continue;

    const expectedType: TransactionType =
      balanceDiff >= 0 ? TransactionType.Credit : TransactionType.Debit;

    // Correct type if balance disagrees
    if (curr.type !== expectedType) {
      result[i] = new Transaction(
        curr.id,
        curr.date,
        curr.description,
        Math.abs(curr.amount),
        expectedType,
        curr.category,
        curr.balance,
        curr.merchant,
        curr.originalText,
        curr.budgetMonth,
        curr.categoryConfidence,
        curr.needsReview,
        curr.categorizedBy,
        curr.sourceType,
        curr.statementId,
        curr.cardIssuer,
        curr.cardLastFour,
        curr.cardHolder,
        curr.currency,
        curr.originalAmount,
        curr.isAnomaly,
        curr.anomalyTypes,
        curr.anomalyDetails,
        curr.anomalyDismissed,
      );
      corrected++;
    }

    // Correct amount if it doesn't match balance difference
    const trueTxnAmount = Math.abs(balanceDiff);
    if (
      Math.abs(Math.abs(curr.amount) - trueTxnAmount) >
      trueTxnAmount * 0.01 + 0.02
    ) {
      if (trueTxnAmount > 0.01) {
        result[i] = new Transaction(
          result[i].id,
          result[i].date,
          result[i].description,
          trueTxnAmount,
          result[i].type,
          result[i].category,
          result[i].balance,
          result[i].merchant,
          result[i].originalText,
          result[i].budgetMonth,
          result[i].categoryConfidence,
          result[i].needsReview,
          result[i].categorizedBy,
          result[i].sourceType,
          result[i].statementId,
          result[i].cardIssuer,
          result[i].cardLastFour,
          result[i].cardHolder,
          result[i].currency,
          result[i].originalAmount,
          result[i].isAnomaly,
          result[i].anomalyTypes,
          result[i].anomalyDetails,
          result[i].anomalyDismissed,
        );
        corrected++;
      }
    }
  }

  if (corrected > 0) {
    debugLog(
      `[PDF] Balance validation corrected ${corrected} transaction(s)`,
    );
  }

  return result;
}
