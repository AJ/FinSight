import Papa from "papaparse";
import { Transaction, TransactionType, Category, SourceType } from "@/types";
import type { StatementType } from "@/types/creditCard";
import { v4 as uuidv4 } from "uuid";
import { parseDate, detectDateOrder } from "./dateParser";
import { detectCurrencyFromText } from "./currencyDetector";
import type { ExtractionBundle, ParsingError } from "./contracts";
import { debugLog, debugWarn } from '@/lib/utils/debug';
import { detectColumns, type ColumnMapping } from "./columnDetection";

export async function parseCSV(file: File, options?: { statementType?: StatementType }): Promise<ExtractionBundle> {
  const statementType = options?.statementType ?? null;
  const sourceType = statementType === 'credit_card' ? SourceType.CreditCard : SourceType.Bank;
  const rawText = await file.text();

  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(rawText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
      complete: (results: Papa.ParseResult<Record<string, string>>) => {
        try {
          const headers = results.meta.fields || [];
          const rows = results.data;

          if (rows.length === 0) {
            throw new Error("CSV file is empty or has no data rows.");
          }

          const parsingErrors: ParsingError[] = [];
          
          if (results.errors.length > 0) {
            results.errors.forEach((err, i) => {
              const error: ParsingError = {
                rowIndex: i,
                rawRow: { error: err.message },
                errorMessage: err.message,
              };
              parsingErrors.push(error);
            });
            debugWarn('csvParser', `Found ${results.errors.length} parsing errors in PapaParse results`);
          }

          const mapping = detectColumns(headers);
          if (!mapping.dateCol) {
            throw new Error(
              "Could not find a date column. Headers found: " + headers.join(", "),
            );
          }
          if (!mapping.amountCol && !mapping.debitCol && !mapping.creditCol) {
            throw new Error(
              "Could not find amount/debit/credit columns. Headers found: " + headers.join(", "),
            );
          }

          debugLog('csvParser', 'Column mapping:', mapping);

          const sampleDates = rows
            .slice(0, 30)
            .map((r) => r[mapping.dateCol!])
            .filter(Boolean);
          const dateOrder = detectDateOrder(sampleDates);
          debugLog('csvParser', 'Detected date order:', dateOrder);

          const fullText =
            headers.join(' ') +
            ' ' +
            rows
              .slice(0, 20)
              .map((r) => Object.values(r).join(' '))
              .join(' ');
          const detectedCurrency = detectCurrencyFromText(fullText);
          debugLog('csvParser', 'Detected currency:', detectedCurrency);

          const transactions: Transaction[] = [];
          const rowParsingErrors: ParsingError[] = [];
          
          rows.forEach((row, index) => {
            const result = parseRow(row, mapping, dateOrder, index, sourceType);
            if (result.transaction) transactions.push(result.transaction);
            if (result.error) rowParsingErrors.push(result.error);
          });

          const allParsingErrors = [...parsingErrors, ...rowParsingErrors];

          debugLog('csvParser', `Parsed ${transactions.length} transactions from ${rows.length} rows`);

          const warnings: string[] = [];
          if (allParsingErrors.length > 0) {
            warnings.push(`${allParsingErrors.length} row(s) failed to parse. Check debug logs for details.`);
          }

          resolve({
            transactions,
            currency: detectedCurrency,
            format: 'csv',
            fileName: file.name,
            parseDate: new Date(),
            statementType,
            statementSummary: null,
            verificationInputs: undefined,
            warnings,
            errors: [],
            parsingErrors: allParsingErrors,
            rawText,
          });
        } catch (error) {
          reject(error);
        }
      },
    });
  });
}

function cleanAmount(raw: string | undefined | null): number | null {
  if (!raw || raw.trim() === '' || raw.trim() === '-' || raw.trim() === '--' || raw.trim().toLowerCase() === 'null') {
    return null;
  }

  let s = raw.trim();
  const isNegative = s.startsWith('(') && s.endsWith(')');
  if (isNegative) s = s.slice(1, -1);

  s = s.replace(/[₹$€£¥₺₽₩₪₦₱₫৳฿A-Za-z\s]/g, '');

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma > lastDot && lastComma > 0) {
    const afterComma = s.substring(lastComma + 1);
    if (afterComma.length <= 2 && /^\d+$/.test(afterComma)) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else {
    s = s.replace(/,/g, '');
  }

  const num = parseFloat(s);
  if (isNaN(num)) return null;
  return isNegative ? -Math.abs(num) : num;
}

function parseRow(
  row: Record<string, string>,
  mapping: ColumnMapping,
  dateOrder: 'DMY' | 'MDY',
  rowIndex: number,
  sourceType: SourceType,
): { transaction: Transaction | null; error: ParsingError | null } {
  try {
    const rawDate = row[mapping.dateCol!];
    const date = parseDate(rawDate, dateOrder);
    if (!date) return { transaction: null, error: null }; // Date parse failure is usually just bad data, not an exception

    const descParts: string[] = [];
    for (const col of mapping.descriptionCols) {
      const val = row[col]?.trim();
      if (val && val.length > 0) descParts.push(val);
    }
    let description = descParts.join(' — ').trim();
    if (!description) description = 'Transaction';

    let amount: number | null = null;
    let type: TransactionType = TransactionType.Debit;

    if (mapping.debitCol && mapping.creditCol) {
      const debit = cleanAmount(row[mapping.debitCol]);
      const credit = cleanAmount(row[mapping.creditCol]);
      if (debit !== null && debit !== 0) {
        amount = Math.abs(debit);
        type = TransactionType.Debit;
      } else if (credit !== null && credit !== 0) {
        amount = Math.abs(credit);
        type = TransactionType.Credit;
      } else {
        return { transaction: null, error: null };
      }
    } else if (mapping.amountCol) {
      amount = cleanAmount(row[mapping.amountCol]);
      if (amount === null || amount === 0) return { transaction: null, error: null };

      if (mapping.typeCol) {
        const rawType = (row[mapping.typeCol] || '').toLowerCase().trim();
        if (rawType.includes('debit') || rawType.includes('dr') || rawType.includes('withdrawal') || rawType.includes('expense')) {
          amount = Math.abs(amount);
          type = TransactionType.Debit;
        } else if (rawType.includes('credit') || rawType.includes('cr') || rawType.includes('deposit') || rawType.includes('income')) {
          amount = Math.abs(amount);
          type = TransactionType.Credit;
        } else {
          type = amount >= 0 ? TransactionType.Credit : TransactionType.Debit;
        }
      } else {
        type = amount >= 0 ? TransactionType.Credit : TransactionType.Debit;
      }
    } else if (mapping.debitCol) {
      const debit = cleanAmount(row[mapping.debitCol]);
      if (debit === null || debit === 0) return { transaction: null, error: null };
      amount = Math.abs(debit);
      type = TransactionType.Debit;
    } else if (mapping.creditCol) {
      const credit = cleanAmount(row[mapping.creditCol]);
      if (credit === null || credit === 0) return { transaction: null, error: null };
      amount = Math.abs(credit);
      type = TransactionType.Credit;
    } else {
      return { transaction: null, error: null };
    }

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
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    debugWarn('csvParser', `Row ${rowIndex} failed to parse: ${errorMessage}`, row);
    return { 
      transaction: null, 
      error: { rowIndex, rawRow: row as unknown as Record<string, unknown>, errorMessage } 
    };
  }
}
