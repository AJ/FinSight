import { describe, it, expect } from 'vitest';
import {
  parseStructuredRows,
  parseCellAmount,
  determineTypeFromColumns,
} from '@/lib/verification/structuredRowParser';

describe('parseStructuredRows — delimiter detection', () => {
  it('detects double-pipe delimiter', () => {
    const text = [
      'Date||Description||Debit||Credit||Balance',
      '01/01/2024||AMAZON PURCHASE||1299.00||||48701.00',
      '15/01/2024||SALARY CREDIT||||50000.00||98701.00',
    ].join('\n');

    const result = parseStructuredRows(text);
    expect(result).not.toBeNull();
    expect(result!.delimiter).toBe('||');
    expect(result!.headers).toEqual(['date', 'description', 'debit', 'credit', 'balance']);
    expect(result!.rows).toHaveLength(2);
  });

  it('detects comma delimiter via papaparse', () => {
    const text = [
      'Date,Description,Debit,Credit,Balance',
      '01/01/2024,AMAZON PURCHASE,1299.00,,48701.00',
      '15/01/2024,SALARY CREDIT,,50000.00,98701.00',
    ].join('\n');

    const result = parseStructuredRows(text);
    expect(result).not.toBeNull();
    expect(result!.delimiter).toBe(',');
    expect(result!.headers).toEqual(['date', 'description', 'debit', 'credit', 'balance']);
    expect(result!.rows).toHaveLength(2);
  });

  it('detects tab delimiter', () => {
    const text = [
      'Date\tDescription\tDebit\tCredit\tBalance',
      '01/01/2024\tAMAZON PURCHASE\t1299.00\t\t48701.00',
      '15/01/2024\tSALARY CREDIT\t\t50000.00\t98701.00',
    ].join('\n');

    const result = parseStructuredRows(text);
    expect(result).not.toBeNull();
    expect(result!.delimiter).toBe('\t');
  });

  it('returns null when no consistent delimiter found', () => {
    const text = 'This is just free-form text\nwithout any columns\nor structure at all';

    const result = parseStructuredRows(text);
    expect(result).toBeNull();
  });

  it('returns null when no data rows (header only)', () => {
    const text = 'Date||Description||Debit||Credit||Balance';

    const result = parseStructuredRows(text);
    expect(result).toBeNull();
  });

  it('parses single data row after header', () => {
    const text = [
      'Date||Description||Debit||Credit||Balance',
      '01/01/2024||AMAZON PURCHASE||1299.00||||48701.00',
    ].join('\n');

    const result = parseStructuredRows(text);
    expect(result).not.toBeNull();
    expect(result!.rows).toHaveLength(1);
    expect(result!.rows[0].cells['debit']).toBe('1299.00');
  });

  it('detects || delimiter with only 2 lines (header + 1 data row)', () => {
    // || is unambiguous — only 1 line with || is needed for detection
    const prose = 'Some bank header text\nAccount number 12345\nPage 1 of 1';
    const table = 'Date||Particulars||Withdrawal||Deposit||Balance\n01-02-2026||Interest paid||||1.00||92.28';
    const text = prose + '\n' + table;

    const result = parseStructuredRows(text);
    expect(result).not.toBeNull();
    expect(result!.delimiter).toBe('||');
    expect(result!.rows).toHaveLength(1);
  });
});

describe('parseStructuredRows — column normalization', () => {
  it('normalizes "Txn Date" to "date"', () => {
    const text = 'Txn Date||Description||Debit||Credit||Balance\n01/01/2024||AMAZON||100||||900\n02/01/2024||FLIPKART||200||||700';
    const result = parseStructuredRows(text);
    expect(result).not.toBeNull();
    expect(result!.headers[0]).toBe('date');
  });

  it('normalizes "Narration" to "description"', () => {
    const text = 'Date||Narration||Debit||Credit||Balance\n01/01/2024||AMAZON||100||||900\n02/01/2024||FLIPKART||200||||700';
    const result = parseStructuredRows(text);
    expect(result).not.toBeNull();
    expect(result!.headers).toContain('description');
  });

  it('normalizes "Particulars" to "description" and "Withdrawal" to "debit"', () => {
    const text = 'Date||Particulars||Withdrawal||Deposit||Balance\n01/01/2024||AMAZON||100||||900\n02/01/2024||FLIPKART||200||||700';
    const result = parseStructuredRows(text);
    expect(result).not.toBeNull();
    expect(result!.headers).toContain('description');
    expect(result!.headers).toContain('debit');
    expect(result!.headers).toContain('credit');
  });

  it('preserves unrecognized column names as-is (lowercased)', () => {
    const text = 'Date||Description||Ref No||Debit||Credit||Balance\n01/01/2024||AMAZON||REF123||100||||900\n02/01/2024||FLIPKART||REF456||200||||700';
    const result = parseStructuredRows(text);
    expect(result).not.toBeNull();
    expect(result!.headers).toContain('ref');
    expect(result!.rows[0].cells['ref']).toBe('REF123');
  });
});

describe('parseStructuredRows — CSV with quoted fields', () => {
  it('handles commas inside quoted amount fields', () => {
    const text = [
      'Date,Description,Debit,Credit,Balance',
      '01/01/2024,AMAZON PURCHASE,"2,424.58",,48701.00',
      '15/01/2024,SALARY CREDIT,,"50,000.00",98701.00',
    ].join('\n');

    const result = parseStructuredRows(text);
    expect(result).not.toBeNull();
    expect(result!.rows[0].cells['debit']).toBe('2,424.58');
    expect(result!.rows[1].cells['credit']).toBe('50,000.00');
  });

  it('handles quoted description with commas', () => {
    const text = [
      'Date,Description,Amount,Balance',
      '01/01/2024,"AMAZON INDIA, MUMBAI",1299.00,48701.00',
      '02/01/2024,"FLIPKART, BANGALORE",500.00,48201.00',
    ].join('\n');

    const result = parseStructuredRows(text);
    expect(result).not.toBeNull();
    expect(result!.rows[0].cells['description']).toBe('AMAZON INDIA, MUMBAI');
  });
});

describe('parseStructuredRows — page break handling', () => {
  it('skips page break markers', () => {
    const text = [
      'Date||Description||Debit||Credit||Balance',
      '01/01/2024||AMAZON||100||||900',
      '--- PAGE BREAK ---',
      '--- PAGE BREAK ---',
      '05/01/2024||FLIPKART||200||||700',
    ].join('\n');

    const result = parseStructuredRows(text);
    expect(result).not.toBeNull();
    expect(result!.rows).toHaveLength(2);
  });
});

describe('parseCellAmount', () => {
  it('parses plain decimal', () => {
    expect(parseCellAmount('1299.00')).toBe(1299.00);
  });

  it('parses comma-separated amount', () => {
    expect(parseCellAmount('2,424.58')).toBe(2424.58);
  });

  it('parses amount with + prefix (credit)', () => {
    expect(parseCellAmount('+430.00')).toBe(430.00);
  });

  it('parses amount with + and space prefix', () => {
    expect(parseCellAmount('+ 430.00')).toBe(430.00);
  });

  it('parses amount with Cr suffix', () => {
    expect(parseCellAmount('220.00Cr')).toBe(220.00);
  });

  it('parses amount with Cr suffix and space', () => {
    expect(parseCellAmount('220.00 Cr')).toBe(220.00);
  });

  it('parses Indian lakh format', () => {
    expect(parseCellAmount('1,35,000.00')).toBe(135000.00);
  });

  it('returns NaN for empty string', () => {
    expect(parseCellAmount('')).toBeNaN();
  });

  it('returns NaN for whitespace-only string', () => {
    expect(parseCellAmount('   ')).toBeNaN();
  });
});

describe('determineTypeFromColumns', () => {
  it('returns debit when amount is in debit column', () => {
    const cells = { debit: '1299.00', credit: '', amount: '', balance: '48701.00' };
    expect(determineTypeFromColumns(cells, 1299.00)).toBe('debit');
  });

  it('returns credit when amount is in credit column', () => {
    const cells = { debit: '', credit: '50000.00', amount: '', balance: '98701.00' };
    expect(determineTypeFromColumns(cells, 50000.00)).toBe('credit');
  });

  it('returns credit when amount has + prefix in single amount column', () => {
    const cells = { debit: '', credit: '', amount: '+430.00', balance: '1000.00' };
    expect(determineTypeFromColumns(cells, 430.00)).toBe('credit');
  });

  it('returns credit when amount has Cr suffix in single amount column', () => {
    const cells = { debit: '', credit: '', amount: '220.00 Cr', balance: '1000.00' };
    expect(determineTypeFromColumns(cells, 220.00)).toBe('credit');
  });

  it('returns debit when plain number in single amount column', () => {
    const cells = { debit: '', credit: '', amount: '1299.00', balance: '48701.00' };
    expect(determineTypeFromColumns(cells, 1299.00)).toBe('debit');
  });

  it('returns null when both debit and credit have values', () => {
    const cells = { debit: '100.00', credit: '100.00', amount: '', balance: '1000.00' };
    expect(determineTypeFromColumns(cells, 100.00)).toBeNull();
  });

  it('returns null when no columns match the amount', () => {
    const cells = { debit: '999.00', credit: '', amount: '', balance: '1000.00' };
    expect(determineTypeFromColumns(cells, 100.00)).toBeNull();
  });
});
