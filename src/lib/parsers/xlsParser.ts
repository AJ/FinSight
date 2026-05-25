import * as XLSX from "xlsx";
import { Transaction, Currency, Category, SourceType } from "@/types";
import type { StatementType } from "@/types/creditCard";
import { v4 as uuidv4 } from "uuid";
import { parseDate, excelSerialToDate } from "./dateParser";
import { detectCurrencyFromText } from "./currencyDetector";
import type { ExtractionBundle, ParsingError } from "./contracts";
import { debugLog, debugWarn } from '@/lib/utils/debug';
import { detectColumns, type ColumnMapping, resolveAmount } from "./columnDetection";

export async function parseXLS(file: File, options?: { statementType?: StatementType }): Promise<ExtractionBundle> {
  const statementType = options?.statementType ?? null;
  const sourceType = statementType === 'credit_card' ? SourceType.CreditCard : SourceType.Bank;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, {
      type: 'array',
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      cellNF: false,
      sheetStubs: false,
    });

    let best: { transactions: Transaction[]; currency: Currency | null; parsingErrors: ParsingError[]; warnings: string[] } = {
      transactions: [],
      currency: null,
      parsingErrors: [],
      warnings: [],
    };
    let rawText = '';

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(worksheet);
      rawText += `Sheet: ${sheetName}\n${csv}\n\n`;

      const result = parseSheet(worksheet, sourceType);
      if (result.transactions.length > best.transactions.length) {
        best = result;
      }
    }

    const format = file.name.endsWith('.xls') ? 'xls' : 'xlsx';

    return {
      transactions: best.transactions,
      currency: best.currency,
      format,
      fileName: file.name,
      parseDate: new Date(),
      statementType,
      statementSummary: null,
      verificationInputs: undefined,
      warnings: best.warnings,
      errors: [],
      parsingErrors: best.parsingErrors,
      rawText,
    };
  } catch (error) {
    console.error('Error parsing XLS/XLSX:', error);
    throw new Error('Failed to parse Excel file');
  }
}

function parseSheet(ws: XLSX.WorkSheet, sourceType: SourceType): {
  transactions: Transaction[];
  currency: Currency | null;
  parsingErrors: ParsingError[];
  warnings: string[];
} {
  const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, {
    defval: '',
  });
  if (rawRows.length === 0) return { transactions: [], currency: null, parsingErrors: [], warnings: [] };

  const headers = Object.keys(rawRows[0]);
  const mapping = detectColumns(headers);

  if (!mapping.dateCol || (!mapping.amountCol && !mapping.debitCol && !mapping.creditCol)) {
    return { transactions: [], currency: null, parsingErrors: [], warnings: [] };
  }

  const sampleText =
    headers.join(' ') +
    ' ' +
    rawRows
      .slice(0, 20)
      .map((r) => Object.values(r).join(' '))
      .join(' ');
  const currency = detectCurrencyFromText(sampleText);

  const transactions: Transaction[] = [];
  const parsingErrors: ParsingError[] = [];

  rawRows.forEach((row, index) => {
    const result = parseRow(row, mapping, index, sourceType);
    if (result.transaction) transactions.push(result.transaction);
    if (result.error) parsingErrors.push(result.error);
  });

  debugLog(`[XLS] Parsed ${transactions.length} transactions from ${rawRows.length} rows`);

  const warnings: string[] = [];
  if (parsingErrors.length > 0) {
    warnings.push(`${parsingErrors.length} row(s) failed to parse. Check debug logs for details.`);
  }

  return { transactions, currency, parsingErrors, warnings };
}

function cleanAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return raw === 0 ? null : raw;

  const s = String(raw).trim();
  if (s === '' || s === '-' || s === '--') return null;

  let cleaned = s.replace(/[₹$€£¥₺₽₩₪₦₱₫৳฿A-Za-z\s]/g, '');
  const isNeg = cleaned.startsWith('(') && cleaned.endsWith(')');
  if (isNeg) cleaned = cleaned.slice(1, -1);

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma > lastDot && lastComma > 0) {
    const after = cleaned.substring(lastComma + 1);
    if (after.length <= 2 && /^\d+$/.test(after)) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else {
    cleaned = cleaned.replace(/,/g, '');
  }

  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return isNeg ? -Math.abs(num) : num;
}

function parseRow(
  row: Record<string, unknown>,
  mapping: ColumnMapping,
  rowIndex: number,
  sourceType: SourceType,
): { transaction: Transaction | null; error: ParsingError | null } {
  const rawRow = row;

  const rawDate = row[mapping.dateCol!];
  let date: Date | null = null;
  if (typeof rawDate === 'number') {
    date = excelSerialToDate(rawDate);
  } else {
    date = parseDate(String(rawDate));
  }
  if (!date) {
    const msg = `Row ${rowIndex}: unparseable date "${rawDate}"`;
    debugWarn('xlsParser', msg, row);
    return { transaction: null, error: { rowIndex, rawRow, errorMessage: msg } };
  }

  const descParts: string[] = [];
  for (const col of mapping.descriptionCols) {
    const val = String(row[col] ?? '').trim();
    if (val.length > 0) descParts.push(val);
  }
  let description = descParts.join(' — ').trim();
  if (!description) description = 'Transaction';

  const debit = cleanAmount(row[mapping.debitCol!]);
  const credit = cleanAmount(row[mapping.creditCol!]);
  const amountRaw = cleanAmount(row[mapping.amountCol!]);
  const typeValue = String(row[mapping.typeCol!] || '');

  const result = resolveAmount({
    debit,
    credit,
    amount: amountRaw,
    typeValue,
    mapping,
    rowIndex,
    rawRow,
  });

  if (!result.ok) {
    debugWarn('xlsParser', result.error.errorMessage, row);
    return { transaction: null, error: result.error };
  }

  const amount = result.amount;
  const type = result.type;

  let balance: number | undefined;
  if (mapping.balanceCol) {
    const bal = cleanAmount(row[mapping.balanceCol]);
    if (bal !== null) balance = bal;
  }

  return {
    transaction: new Transaction(
      uuidv4(),
      date,
      description,
      amount,
      type,
      Category.fromId('other')!,
      balance,
      undefined,
      JSON.stringify(row),
      undefined,
      undefined,
      undefined,
      undefined,
      sourceType,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      1.0,
      undefined,
    ),
    error: null,
  };
}
