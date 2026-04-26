import { describe, it, expect } from 'vitest';
import {
  normalizeHeader,
  matchesAny,
  findColumn,
  detectColumns,
  DATE_KEYWORDS,
  DEBIT_KEYWORDS,
  CREDIT_KEYWORDS,
  TYPE_KEYWORDS,
} from '@/lib/parsers/columnDetection';
import type { ColumnMapping } from '@/lib/parsers/columnDetection';

describe('normalizeHeader', () => {
  it('lowercases input', () => {
    expect(normalizeHeader('DATE')).toBe('date');
  });

  it('trims whitespace', () => {
    expect(normalizeHeader('  date  ')).toBe('date');
  });

  it('strips non-alphanumeric except spaces and forward slashes', () => {
    expect(normalizeHeader('  Date (DD/MM)  ')).toBe('date dd/mm');
  });

  it('keeps digits', () => {
    expect(normalizeHeader('Column 1')).toBe('column 1');
  });

  it('removes currency symbols and parentheses', () => {
    expect(normalizeHeader('Amount (₹)')).toBe('amount');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeHeader('')).toBe('');
  });
});

describe('matchesAny — basic matching', () => {
  it('matches an exact keyword', () => {
    expect(matchesAny('credit', CREDIT_KEYWORDS)).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(matchesAny('CREDIT', CREDIT_KEYWORDS)).toBe(true);
    expect(matchesAny('Credit', CREDIT_KEYWORDS)).toBe(true);
  });

  it('matches multi-word keywords', () => {
    expect(matchesAny('credit amount', CREDIT_KEYWORDS)).toBe(true);
    expect(matchesAny('withdrawal amount', DEBIT_KEYWORDS)).toBe(true);
  });

  it('matches standalone short keywords', () => {
    expect(matchesAny('cr', CREDIT_KEYWORDS)).toBe(true);
    expect(matchesAny('dr', DEBIT_KEYWORDS)).toBe(true);
  });

  it('matches keyword inside slash-separated header via word boundary', () => {
    expect(matchesAny('cr/dr', CREDIT_KEYWORDS)).toBe(true);
    expect(matchesAny('dr/cr', DEBIT_KEYWORDS)).toBe(true);
  });

  it('returns false for non-matching header', () => {
    expect(matchesAny('balance', CREDIT_KEYWORDS)).toBe(false);
  });

  it('returns false when keywords array is empty', () => {
    expect(matchesAny('date', [])).toBe(false);
  });
});

describe('matchesAny — word-boundary false positive prevention', () => {
  it('"description" does NOT match CREDIT_KEYWORDS despite containing "cr"', () => {
    expect(matchesAny('description', CREDIT_KEYWORDS)).toBe(false);
  });

  it('"order" does NOT match DEBIT_KEYWORDS', () => {
    expect(matchesAny('order', DEBIT_KEYWORDS)).toBe(false);
  });

  it('"android" does NOT match DEBIT_KEYWORDS despite containing "dr"', () => {
    expect(matchesAny('android', DEBIT_KEYWORDS)).toBe(false);
  });
});

describe('findColumn', () => {
  it('returns first matching header', () => {
    expect(findColumn(['Date', 'Description', 'Amount'], DATE_KEYWORDS)).toBe('Date');
  });

  it('returns null when no header matches', () => {
    expect(findColumn(['Foo', 'Bar'], DATE_KEYWORDS)).toBeNull();
  });

  it('returns first match when multiple headers match', () => {
    expect(findColumn(['Date', 'Txn Date'], DATE_KEYWORDS)).toBe('Date');
  });

  it('returns null for empty headers', () => {
    expect(findColumn([], DATE_KEYWORDS)).toBeNull();
  });
});

describe('detectColumns', () => {
  it('maps standard bank headers', () => {
    const result = detectColumns(['Date', 'Description', 'Debit', 'Credit', 'Balance']);
    expect(result).toEqual<ColumnMapping>({
      dateCol: 'Date',
      descriptionCols: ['Description'],
      amountCol: null,
      debitCol: 'Debit',
      creditCol: 'Credit',
      typeCol: null,
      balanceCol: 'Balance',
    });
  });

  it('maps alternate header names (Narration, Withdrawal, Deposit)', () => {
    const result = detectColumns(['Txn Date', 'Narration', 'Withdrawal', 'Deposit', 'Running Balance']);
    expect(result.dateCol).toBe('Txn Date');
    expect(result.descriptionCols).toEqual(['Narration']);
    expect(result.debitCol).toBe('Withdrawal');
    expect(result.creditCol).toBe('Deposit');
    expect(result.balanceCol).toBe('Running Balance');
  });

  it('maps amount-only headers (no debit/credit split)', () => {
    const result = detectColumns(['Date', 'Description', 'Amount']);
    expect(result).toEqual<ColumnMapping>({
      dateCol: 'Date',
      descriptionCols: ['Description'],
      amountCol: 'Amount',
      debitCol: null,
      creditCol: null,
      typeCol: null,
      balanceCol: null,
    });
  });

  it('maps headers with a type column', () => {
    const result = detectColumns(['Date', 'Details', 'Amount', 'Type']);
    expect(result.dateCol).toBe('Date');
    expect(result.amountCol).toBe('Amount');
    expect(result.typeCol).toBe('Type');
  });

  it('collects multiple description columns', () => {
    const result = detectColumns(['Date', 'Description', 'Details', 'Amount']);
    expect(result.descriptionCols).toEqual(['Description', 'Details']);
  });

  it('falls back to first unrecognized header as description', () => {
    const result = detectColumns(['Date', 'Something', 'Amount']);
    expect(result.descriptionCols).toEqual(['Something']);
  });

  it('leaves descriptionCols empty when all headers assigned to known roles', () => {
    const result = detectColumns(['Date', 'Amount']);
    expect(result.descriptionCols).toEqual([]);
  });

  it('returns null dateCol when no date header present', () => {
    const result = detectColumns(['Description', 'Debit', 'Credit']);
    expect(result.dateCol).toBeNull();
    expect(result.debitCol).toBe('Debit');
    expect(result.creditCol).toBe('Credit');
  });

  it('returns all nulls for empty input', () => {
    expect(detectColumns([])).toEqual<ColumnMapping>({
      dateCol: null,
      descriptionCols: [],
      amountCol: null,
      debitCol: null,
      creditCol: null,
      typeCol: null,
      balanceCol: null,
    });
  });
});
