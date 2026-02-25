import * as XLSX from "xlsx";
import { Transaction, ParsedStatement, Currency } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { parseDate, excelSerialToDate } from "./dateParser";
import { detectCurrencyFromText } from "./currencyDetector";
import { debugLog } from "@/lib/utils/debug";

/* ============================================================
   UNIVERSAL EXCEL PARSER
   Handles .xls and .xlsx from any bank in any country.
   Strategy: convert sheet → JSON rows then use the same
   column-detection logic as the CSV parser.
   ============================================================ */

export interface XLSParseResult {
  statement: ParsedStatement;
  detectedCurrency: Currency | null;
}

export async function parseXLS(file: File): Promise<XLSParseResult> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    // Hardened XLSX parsing: disable potentially dangerous features
    const workbook = XLSX.read(arrayBuffer, {
      type: "array",
      cellFormula: false,    // Disable formula parsing
      cellHTML: false,       // Disable HTML parsing
      cellStyles: false,     // Disable style parsing
      cellNF: false,         // Disable number format parsing
      sheetStubs: false,     // Disable stub cells
    });

    // Try every sheet — use the one that yields the most transactions
    let best: { transactions: Transaction[]; currency: Currency | null } = {
      transactions: [],
      currency: null,
    };

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];

      // First, try header mode, then raw mode if header yields nothing
      const { transactions, currency } = parseSheet(worksheet);
      if (transactions.length > best.transactions.length) {
        best = { transactions, currency };
      }
    }

    const format = file.name.endsWith(".xls") ? "xls" : "xlsx";

    return {
      statement: {
        transactions: best.transactions,
        format,
        fileName: file.name,
        parseDate: new Date(),
      },
      detectedCurrency: best.currency,
    };
  } catch (error) {
    console.error("Error parsing XLS/XLSX:", error);
    throw new Error("Failed to parse Excel file");
  }
}

/* ── Sheet parsing ────────────────────────────────────────── */

function parseSheet(ws: XLSX.WorkSheet): {
  transactions: Transaction[];
  currency: Currency | null;
} {
  // Convert to JSON with header row
  const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, {
    defval: "",
  });
  if (rawRows.length === 0) return { transactions: [], currency: null };

  const headers = Object.keys(rawRows[0]);
  const mapping = detectColumns(headers);

  if (
    !mapping.dateCol ||
    (!mapping.amountCol && !mapping.debitCol && !mapping.creditCol)
  ) {
    return { transactions: [], currency: null };
  }

  // Detect currency from headers + first few rows
  const sampleText =
    headers.join(" ") +
    " " +
    rawRows
      .slice(0, 20)
      .map((r) => Object.values(r).join(" "))
      .join(" ");
  const currency = detectCurrencyFromText(sampleText);

  const transactions: Transaction[] = [];
  for (const row of rawRows) {
    const txn = parseRow(row, mapping);
    if (txn) transactions.push(txn);
  }

  debugLog(
    `[XLS] Parsed ${transactions.length} transactions from ${rawRows.length} rows`,
  );
  return { transactions, currency };
}

/* ── Column detection (mirrors CSV parser) ──────────────── */

const DATE_KEYWORDS = [
  "date",
  "txn date",
  "transaction date",
  "trans date",
  "value date",
  "posting date",
  "book date",
  "datum",
  "fecha",
];
const DESC_KEYWORDS = [
  "description",
  "narration",
  "particulars",
  "details",
  "memo",
  "reference",
  "remark",
  "transaction details",
  "merchant",
  "payee",
  "beneficiary",
  "name",
];
const AMOUNT_KEYWORDS = ["amount", "transaction amount", "txn amount"];
const DEBIT_KEYWORDS = [
  "debit",
  "withdrawal",
  "dr",
  "debit amount",
  "withdrawal amount",
  "money out",
];
const CREDIT_KEYWORDS = [
  "credit",
  "deposit",
  "cr",
  "credit amount",
  "deposit amount",
  "money in",
];
const TYPE_KEYWORDS = [
  "type",
  "transaction type",
  "txn type",
  "cr/dr",
  "dr/cr",
];
const BALANCE_KEYWORDS = ["balance", "closing balance", "running balance"];

interface ColumnMapping {
  dateCol: string | null;
  descriptionCols: string[];
  amountCol: string | null;
  debitCol: string | null;
  creditCol: string | null;
  typeCol: string | null;
  balanceCol: string | null;
}

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9\s/]/g, "")
    .trim();
}

function matchesAny(header: string, keywords: string[]): boolean {
  const norm = normalizeHeader(header);
  return keywords.some((kw) => norm === kw || norm.includes(kw));
}

function findColumn(headers: string[], keywords: string[]): string | null {
  for (const h of headers) {
    if (matchesAny(h, keywords)) return h;
  }
  return null;
}

function detectColumns(headers: string[]): ColumnMapping {
  const dateCol = findColumn(headers, DATE_KEYWORDS);
  const amountCol = findColumn(headers, AMOUNT_KEYWORDS);
  const debitCol = findColumn(headers, DEBIT_KEYWORDS);
  const creditCol = findColumn(headers, CREDIT_KEYWORDS);
  const typeCol = findColumn(headers, TYPE_KEYWORDS);
  const balanceCol = findColumn(headers, BALANCE_KEYWORDS);

  const descriptionCols: string[] = [];
  for (const h of headers) {
    if (matchesAny(h, DESC_KEYWORDS)) descriptionCols.push(h);
  }
  if (descriptionCols.length === 0) {
    const usedCols = new Set(
      [dateCol, amountCol, debitCol, creditCol, typeCol, balanceCol].filter(
        Boolean,
      ),
    );
    for (const h of headers) {
      if (!usedCols.has(h)) {
        descriptionCols.push(h);
        break;
      }
    }
  }

  return {
    dateCol,
    descriptionCols,
    amountCol,
    debitCol,
    creditCol,
    typeCol,
    balanceCol,
  };
}

/* ── Row parsing ──────────────────────────────────────────── */

function cleanAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return raw === 0 ? null : raw;

  const s = String(raw).trim();
  if (s === "" || s === "-" || s === "--") return null;

  // Remove currency symbols and letters
  let cleaned = s.replace(/[₹$€£¥₺₽₩₪₦₱₫৳฿A-Za-z\s]/g, "");
  const isNeg = cleaned.startsWith("(") && cleaned.endsWith(")");
  if (isNeg) cleaned = cleaned.slice(1, -1);

  // Handle decimal separator
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma > lastDot && lastComma > 0) {
    const after = cleaned.substring(lastComma + 1);
    if (after.length <= 2 && /^\d+$/.test(after)) {
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }

  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return isNeg ? -Math.abs(num) : num;
}

function parseRow(
  row: Record<string, unknown>,
  mapping: ColumnMapping,
): Transaction | null {
  try {
    // --- Date ---
    const rawDate = row[mapping.dateCol!];
    let date: Date | null = null;
    if (typeof rawDate === "number") {
      date = excelSerialToDate(rawDate);
    } else {
      date = parseDate(String(rawDate));
    }
    if (!date) return null;

    // --- Description ---
    const descParts: string[] = [];
    for (const col of mapping.descriptionCols) {
      const val = String(row[col] ?? "").trim();
      if (val.length > 0) descParts.push(val);
    }
    let description = descParts.join(" — ").trim();
    if (!description) description = "Transaction";

    // --- Amount ---
    let amount: number | null = null;
    let type: "income" | "expense" = "expense";

    if (mapping.debitCol && mapping.creditCol) {
      const debit = cleanAmount(row[mapping.debitCol]);
      const credit = cleanAmount(row[mapping.creditCol]);
      if (debit !== null && debit !== 0) {
        amount = -Math.abs(debit);
        type = "expense";
      } else if (credit !== null && credit !== 0) {
        amount = Math.abs(credit);
        type = "income";
      } else {
        return null;
      }
    } else if (mapping.amountCol) {
      amount = cleanAmount(row[mapping.amountCol]);
      if (amount === null || amount === 0) return null;

      if (mapping.typeCol) {
        const rawType = String(row[mapping.typeCol] || "")
          .toLowerCase()
          .trim();
        if (
          rawType.includes("debit") ||
          rawType.includes("dr") ||
          rawType.includes("withdrawal")
        ) {
          amount = -Math.abs(amount);
          type = "expense";
        } else if (
          rawType.includes("credit") ||
          rawType.includes("cr") ||
          rawType.includes("deposit")
        ) {
          amount = Math.abs(amount);
          type = "income";
        } else {
          type = amount >= 0 ? "income" : "expense";
        }
      } else {
        type = amount >= 0 ? "income" : "expense";
      }
    } else if (mapping.debitCol) {
      const debit = cleanAmount(row[mapping.debitCol]);
      if (debit === null || debit === 0) return null;
      amount = -Math.abs(debit);
      type = "expense";
    } else if (mapping.creditCol) {
      const credit = cleanAmount(row[mapping.creditCol]);
      if (credit === null || credit === 0) return null;
      amount = Math.abs(credit);
      type = "income";
    } else {
      return null;
    }

    // Capture balance value if available
    let balance: number | undefined = undefined;
    if (mapping.balanceCol) {
      const bal = cleanAmount(row[mapping.balanceCol]);
      if (bal !== null) balance = bal;
    }

    return {
      id: uuidv4(),
      date,
      description,
      amount,
      category: "other",
      type,
      balance,
      originalText: JSON.stringify(row),
    };
  } catch {
    return null;
  }
}
