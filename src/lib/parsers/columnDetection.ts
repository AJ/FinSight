/**
 * Shared column detection logic for structured statement parsers (CSV, XLS).
 * Matches header names to semantic roles using keyword lists with fuzzy matching.
 */

import type { TransactionType } from '@/types';
import { TransactionType as TT } from '@/types';
import type { ParsingError } from './contracts';

export type AmountResult =
  | { ok: true; amount: number; type: TransactionType }
  | { ok: false; error: ParsingError };

export function resolveAmount(params: {
  debit: number | null;
  credit: number | null;
  amount: number | null;
  typeValue: string;
  mapping: ColumnMapping;
  rowIndex: number;
  rawRow: Record<string, unknown>;
}): AmountResult {
  const { mapping, rowIndex, rawRow } = params;

  if (mapping.debitCol && mapping.creditCol) {
    if (params.debit !== null && params.debit !== 0) {
      return { ok: true, amount: Math.abs(params.debit), type: TT.Debit };
    }
    if (params.credit !== null && params.credit !== 0) {
      return { ok: true, amount: Math.abs(params.credit), type: TT.Credit };
    }
    return {
      ok: false,
      error: {
        rowIndex,
        rawRow,
        errorMessage: `Row ${rowIndex}: debit ("${rawRow[mapping.debitCol]}") and credit ("${rawRow[mapping.creditCol]}") both null or zero`,
      },
    };
  }

  if (mapping.amountCol) {
    if (params.amount === null || params.amount === 0) {
      return {
        ok: false,
        error: {
          rowIndex,
          rawRow,
          errorMessage: `Row ${rowIndex}: unparseable amount "${rawRow[mapping.amountCol]}"`,
        },
      };
    }

    const rawType = params.typeValue.toLowerCase().trim();
    if (rawType.includes('debit') || rawType.includes('dr') || rawType.includes('withdrawal') || rawType.includes('expense')) {
      return { ok: true, amount: Math.abs(params.amount), type: TT.Debit };
    }
    if (rawType.includes('credit') || rawType.includes('cr') || rawType.includes('deposit') || rawType.includes('income')) {
      return { ok: true, amount: Math.abs(params.amount), type: TT.Credit };
    }

    const type = params.amount >= 0 ? TT.Credit : TT.Debit;
    return { ok: true, amount: Math.abs(params.amount), type };
  }

  if (mapping.debitCol) {
    if (params.debit === null || params.debit === 0) {
      return {
        ok: false,
        error: {
          rowIndex,
          rawRow,
          errorMessage: `Row ${rowIndex}: unparseable debit "${rawRow[mapping.debitCol]}"`,
        },
      };
    }
    return { ok: true, amount: Math.abs(params.debit), type: TT.Debit };
  }

  if (mapping.creditCol) {
    if (params.credit === null || params.credit === 0) {
      return {
        ok: false,
        error: {
          rowIndex,
          rawRow,
          errorMessage: `Row ${rowIndex}: unparseable credit "${rawRow[mapping.creditCol]}"`,
        },
      };
    }
    return { ok: true, amount: Math.abs(params.credit), type: TT.Credit };
  }

  return {
    ok: false,
    error: {
      rowIndex,
      rawRow,
      errorMessage: `Row ${rowIndex}: no amount columns available`,
    },
  };
}

export interface ColumnMapping {
  dateCol: string | null;
  descriptionCols: string[];
  amountCol: string | null;
  debitCol: string | null;
  creditCol: string | null;
  typeCol: string | null;
  balanceCol: string | null;
}

export const DATE_KEYWORDS = [
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

export const DESC_KEYWORDS = [
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

export const AMOUNT_KEYWORDS = ["amount", "transaction amount", "txn amount"];

export const DEBIT_KEYWORDS = [
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

export const CREDIT_KEYWORDS = [
  "credit",
  "deposit",
  "cr",
  "credit amount",
  "deposit amount",
  "credit(cr)",
  "money in",
  "received",
];

export const TYPE_KEYWORDS = ["type", "transaction type", "txn type", "cr/dr", "dr/cr"];

export const BALANCE_KEYWORDS = [
  "balance",
  "closing balance",
  "running balance",
  "available balance",
];

export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9\s/]/g, "")
    .trim();
}

export function matchesAny(header: string, keywords: string[]): boolean {
  const norm = normalizeHeader(header);
  return keywords.some((kw) => norm === kw || new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(norm));
}

export function findColumn(headers: string[], keywords: string[]): string | null {
  for (const h of headers) {
    if (matchesAny(h, keywords)) return h;
  }
  return null;
}

export function detectColumns(headers: string[]): ColumnMapping {
  const dateCol = findColumn(headers, DATE_KEYWORDS);
  const amountCol = findColumn(headers, AMOUNT_KEYWORDS);
  const debitCol = findColumn(headers, DEBIT_KEYWORDS);
  const creditCol = findColumn(headers, CREDIT_KEYWORDS);
  const typeCol = findColumn(headers, TYPE_KEYWORDS);
  const balanceCol = findColumn(headers, BALANCE_KEYWORDS);

  const descriptionCols: string[] = [];
  for (const h of headers) {
    if (matchesAny(h, DESC_KEYWORDS)) {
      descriptionCols.push(h);
    }
  }

  if (descriptionCols.length === 0) {
    const usedCols = new Set([dateCol, amountCol, debitCol, creditCol, typeCol, balanceCol].filter(Boolean));
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
