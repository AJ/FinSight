import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/utils/debug', () => ({
  debugLog: vi.fn(),
  debugWarn: vi.fn(),
  debugError: vi.fn(),
}));

const mockSheetToJson = vi.fn();
const mockSheetToCsv = vi.fn();
const mockRead = vi.fn();

vi.mock('xlsx', () => ({
  read: (...args: unknown[]) => mockRead(...args),
  utils: {
    sheet_to_json: (...args: unknown[]) => mockSheetToJson(...args),
    sheet_to_csv: (...args: unknown[]) => mockSheetToCsv(...args),
  },
}));

import { parseXLS } from '@/lib/parsers/xlsParser';
import { makeFile } from '../factories';

function makeXlsFile(name = 'test.xlsx'): File {
  return makeFile('dummy binary', name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

function makeWorkbookData(headers: string[], rows: Record<string, unknown>[]) {
  return { headers, rows };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseXLS', () => {
  it('parses single-sheet XLSX with standard headers', async () => {
    const data = makeWorkbookData(
      ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
      [
        { Date: '01/01/2024', Description: 'Grocery', Debit: 50, Credit: '', Balance: 950 },
        { Date: '02/01/2024', Description: 'Salary', Debit: '', Credit: 3000, Balance: 3950 },
      ],
    );

    mockRead.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    });
    mockSheetToJson.mockReturnValue(data.rows);
    mockSheetToCsv.mockReturnValue('Date,Description,Debit,Credit,Balance\n...');

    const result = await parseXLS(makeXlsFile());

    expect(result.transactions).toHaveLength(2);
    expect(result.format).toBe('xlsx');
    expect(result.fileName).toBe('test.xlsx');
    expect(result.statementType).toBeNull();
  });

  it('parses multi-sheet workbook, selecting sheet with most rows', async () => {
    const goodRows = [
      { Date: '01/01/2024', Description: 'Grocery', Amount: 50 },
      { Date: '02/01/2024', Description: 'Gas', Amount: 40 },
    ];
    const sparseRows = [
      { Date: '01/01/2024', Amount: 10 },
    ];

    mockRead.mockReturnValue({
      SheetNames: ['Summary', 'Transactions'],
      Sheets: { Summary: {}, Transactions: {} },
    });
    mockSheetToJson
      .mockReturnValueOnce(sparseRows)
      .mockReturnValueOnce(goodRows);
    mockSheetToCsv.mockReturnValue('');

    const result = await parseXLS(makeXlsFile());

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].description).toBe('Grocery');
  });

  it('handles Excel serial date numbers with correct date', async () => {
    const rows = [
      { Date: 45292, Description: 'Test', Amount: 100 },
    ];

    mockRead.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    });
    mockSheetToJson.mockReturnValue(rows);
    mockSheetToCsv.mockReturnValue('');

    const result = await parseXLS(makeXlsFile());

    expect(result.transactions).toHaveLength(1);
    const d = result.transactions[0].date;
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(0); // January
    expect(d.getDate()).toBe(1);
  });

  it('detects .xls format from file extension', async () => {
    mockRead.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    });
    mockSheetToJson.mockReturnValue([
      { Date: '01/01/2024', Description: 'Test', Debit: 10, Credit: '' },
    ]);
    mockSheetToCsv.mockReturnValue('');

    const result = await parseXLS(makeXlsFile('legacy.xls'));

    expect(result.format).toBe('xls');
  });

  it('returns empty transactions for sheet with no matching headers', async () => {
    mockRead.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    });
    mockSheetToJson.mockReturnValue([
      { Foo: 'bar', Baz: 'qux' },
    ]);
    mockSheetToCsv.mockReturnValue('Foo,Baz\nbar,qux');

    const result = await parseXLS(makeXlsFile());

    expect(result.transactions).toHaveLength(0);
  });

  it('returns empty transactions for empty sheet', async () => {
    mockRead.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    });
    mockSheetToJson.mockReturnValue([]);

    const result = await parseXLS(makeXlsFile());

    expect(result.transactions).toHaveLength(0);
  });

  it('sets credit_card sourceType when statementType option provided', async () => {
    mockRead.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    });
    mockSheetToJson.mockReturnValue([
      { Date: '01/01/2024', Description: 'Purchase', Amount: 500 },
    ]);
    mockSheetToCsv.mockReturnValue('');

    const result = await parseXLS(makeXlsFile(), { statementType: 'credit_card' });

    expect(result.statementType).toBe('credit_card');
    expect(result.transactions[0].sourceType).toBe('credit_card');
  });

  it('throws on corrupt file', async () => {
    mockRead.mockImplementation(() => {
      throw new Error('Invalid XLS');
    });

    await expect(parseXLS(makeXlsFile())).rejects.toThrow('Failed to parse Excel file');
  });

  it('includes rawText from all sheets', async () => {
    mockRead.mockReturnValue({
      SheetNames: ['Sheet1', 'Sheet2'],
      Sheets: { Sheet1: {}, Sheet2: {} },
    });
    mockSheetToJson.mockReturnValue([]);
    mockSheetToCsv.mockReturnValue('csv-content');

    const result = await parseXLS(makeXlsFile());

    expect(result.rawText).toContain('Sheet: Sheet1');
    expect(result.rawText).toContain('Sheet: Sheet2');
  });

  it('skips rows with zero or empty amounts', async () => {
    mockRead.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    });
    mockSheetToJson.mockReturnValue([
      { Date: '01/01/2024', Description: 'Valid', Debit: 10, Credit: '' },
      { Date: '02/01/2024', Description: 'Zero', Debit: 0, Credit: 0 },
      { Date: '03/01/2024', Description: 'Empty', Debit: '', Credit: '' },
    ]);
    mockSheetToCsv.mockReturnValue('');

    const result = await parseXLS(makeXlsFile());

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].description).toBe('Valid');
  });

  it('captures balance when Balance column present', async () => {
    mockRead.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    });
    mockSheetToJson.mockReturnValue([
      { Date: '01/01/2024', Description: 'Grocery', Debit: 50, Credit: '', Balance: 950 },
      { Date: '02/01/2024', Description: 'Salary', Debit: '', Credit: 3000, Balance: 3950 },
    ]);
    mockSheetToCsv.mockReturnValue('Date,Description,Debit,Credit,Balance\n...');

    const result = await parseXLS(makeXlsFile());

    expect(result.transactions[0].balance).toBe(950);
    expect(result.transactions[1].balance).toBe(3950);
  });

  it('detects currency from cell content', async () => {
    mockRead.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    });
    mockSheetToJson.mockReturnValue([
      { Date: '01/01/2024', Description: 'Grocery ₹', Amount: 500 },
    ]);
    mockSheetToCsv.mockReturnValue('Date,Description,Amount\n01/01/2024,Grocery ₹,500');

    const result = await parseXLS(makeXlsFile());

    expect(result.currency).toBeDefined();
    expect(result.currency?.code).toBe('INR');
  });

  it('populates parsingErrors for rows that fail', async () => {
    mockRead.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    });
    mockSheetToJson.mockReturnValue([
      { Date: 'not-a-date', Description: 'Bad', Amount: 100 },
      { Date: '01/01/2024', Description: 'Good', Amount: 200 },
    ]);
    mockSheetToCsv.mockReturnValue('');

    const result = await parseXLS(makeXlsFile());

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].description).toBe('Good');
  });
});
