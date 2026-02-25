import Papa from "papaparse";
import { Transaction, ParsedStatement, Currency } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { parseDate, detectDateOrder } from "./dateParser";
import { detectCurrencyFromText } from "./currencyDetector";

/* ============================================================
   UNIVERSAL CSV PARSER
   Handles bank statements from any bank in any country.
   ============================================================ */

interface ColumnMapping {
  dateCol: string | null;
  descriptionCols: string[]; // may combine multiple columns
  amountCol: string | null; // single amount column (signed)
  debitCol: string | null; // separate debit column
  creditCol: string | null; // separate credit column
  typeCol: string | null; // explicit type column
  balanceCol: string | null; // running balance (for type inference)
}

/** Parsed result with detected currency */
export interface CSVParseResult {
  statement: ParsedStatement;
  detectedCurrency: Currency | null;
}

export async function parseCSV(file: File): Promise<CSVParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
      complete: (results) => {
        try {
          const headers = results.meta.fields || [];
          const rows = results.data as Record<string, string>[];

          if (rows.length === 0) {
            throw new Error("CSV file is empty or has no data rows.");
          }

          // 1. Auto-detect column mapping
          const mapping = detectColumns(headers);
          if (!mapping.dateCol) {
            throw new Error(
              "Could not find a date column. Headers found: " +
                headers.join(", "),
            );
          }
          if (!mapping.amountCol && !mapping.debitCol && !mapping.creditCol) {
            throw new Error(
              "Could not find amount/debit/credit columns. Headers found: " +
                headers.join(", "),
            );
          }

          console.log("[CSV] Column mapping:", mapping);

          // 2. Detect date order (DD/MM vs MM/DD)
          const sampleDates = rows
            .slice(0, 30)
            .map((r) => r[mapping.dateCol!])
            .filter(Boolean);
          const dateOrder = detectDateOrder(sampleDates);
          console.log("[CSV] Detected date order:", dateOrder);

          // 3. Detect currency
          const fullText =
            headers.join(" ") +
            " " +
            rows
              .slice(0, 20)
              .map((r) => Object.values(r).join(" "))
              .join(" ");
          const detectedCurrency = detectCurrencyFromText(fullText);
          console.log("[CSV] Detected currency:", detectedCurrency);

          // 4. Parse each row
          const transactions: Transaction[] = [];
          for (const row of rows) {
            const txn = parseRow(row, mapping);
            if (txn) transactions.push(txn);
          }

          console.log(
            `[CSV] Parsed ${transactions.length} transactions from ${rows.length} rows`,
          );

          resolve({
            statement: {
              transactions,
              format: "csv",
              fileName: file.name,
              parseDate: new Date(),
            },
            detectedCurrency,
          });
        } catch (error) {
          reject(error);
        }
      },
      error: (error) => {
        reject(error);
      },
    });
  });
}

/* ── Column detection ─────────────────────────────────────── */

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
  "tarikh",
  "tanggal",
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
  "keterangan",
];
const AMOUNT_KEYWORDS = ["amount", "transaction amount", "txn amount"];
const DEBIT_KEYWORDS = [
  "debit",
  "withdrawal",
  "dr",
  "debit amount",
  "withdrawal amount",
  "debit(dr)",
  "money out",
  "spent",
  "expense",
];
const CREDIT_KEYWORDS = [
  "credit",
  "deposit",
  "cr",
  "credit amount",
  "deposit amount",
  "credit(cr)",
  "money in",
  "received",
];
const TYPE_KEYWORDS = [
  "type",
  "transaction type",
  "txn type",
  "cr/dr",
  "dr/cr",
];
const BALANCE_KEYWORDS = [
  "balance",
  "closing balance",
  "running balance",
  "available balance",
];

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

  // Description: may combine multiple cols
  const descriptionCols: string[] = [];
  for (const h of headers) {
    if (matchesAny(h, DESC_KEYWORDS)) {
      descriptionCols.push(h);
    }
  }

  // If no description column found, use a column that isn't already mapped
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

function cleanAmount(raw: string | undefined | null): number | null {
  if (
    !raw ||
    raw.trim() === "" ||
    raw.trim() === "-" ||
    raw.trim() === "--" ||
    raw.trim().toLowerCase() === "null"
  )
    return null;

  let s = raw.trim();
  const isNegative = s.startsWith("(") && s.endsWith(")");
  if (isNegative) s = s.slice(1, -1);

  // Remove currency symbols and letters, keep digits, dots, commas, minus
  s = s.replace(/[₹$€£¥₺₽₩₪₦₱₫৳฿A-Za-z\s]/g, "");

  // Detect if comma is decimal separator
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma > lastDot && lastComma > 0) {
    const afterComma = s.substring(lastComma + 1);
    if (afterComma.length <= 2 && /^\d+$/.test(afterComma)) {
      // European format: comma is decimal
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else {
    s = s.replace(/,/g, "");
  }

  const num = parseFloat(s);
  if (isNaN(num)) return null;
  return isNegative ? -Math.abs(num) : num;
}

function parseRow(
  row: Record<string, string>,
  mapping: ColumnMapping,
): Transaction | null {
  try {
    // --- Date ---
    const rawDate = row[mapping.dateCol!];
    const date = parseDate(rawDate);
    if (!date) return null;

    // --- Description ---
    const descParts: string[] = [];
    for (const col of mapping.descriptionCols) {
      const val = row[col]?.trim();
      if (val && val.length > 0) descParts.push(val);
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
        const rawType = (row[mapping.typeCol] || "").toLowerCase().trim();
        if (
          rawType.includes("debit") ||
          rawType.includes("dr") ||
          rawType.includes("withdrawal") ||
          rawType.includes("expense")
        ) {
          amount = -Math.abs(amount);
          type = "expense";
        } else if (
          rawType.includes("credit") ||
          rawType.includes("cr") ||
          rawType.includes("deposit") ||
          rawType.includes("income")
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
