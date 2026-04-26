import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { extractStatementBundleFromFile } from '@/lib/parsers/extractStatementBundle';
import { parseCSV } from '@/lib/parsers/csvParser';
import { parseXLS } from '@/lib/parsers/xlsParser';

function createCsvFile(contents: string, name = 'statement.csv'): File {
  return new File([contents], name, { type: 'text/csv' });
}

function createXlsxFile(rows: Array<Record<string, string | number>>, name = 'statement.xlsx'): File {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const array = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return new File([array], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('parser neutralization boundary', () => {
  it('parseCSV returns a neutral extraction bundle', async () => {
    const csvLines = [
      'Date,Description,Debit,Credit,Balance',
      '2024-01-20,Salary,,5000,10000',
      '2024-01-21,Coffee,250,,9750',
    ];
    const file = createCsvFile(csvLines.join('\n'));

    const bundle = await parseCSV(file);

    expect(bundle.format).toBe('csv');
    expect(bundle.fileName).toBe('statement.csv');
    expect(bundle.transactions).toHaveLength(2);
    expect(bundle.statementType).toBeNull();
    expect(bundle.statementSummary).toBeNull();
    expect(bundle.verificationInputs).toBeUndefined();
    expect(bundle.parsingErrors).toEqual([]);
    expect(bundle.rawText).toContain('Salary');
  });

  it('parseXLS returns a neutral extraction bundle', async () => {
    const file = createXlsxFile([
      {
        Date: '2024-01-20',
        Description: 'Salary',
        Credit: 5000,
        Balance: 10000,
      },
      {
        Date: '2024-01-21',
        Description: 'Coffee',
        Debit: 250,
        Balance: 9750,
      },
    ]);

    const bundle = await parseXLS(file);

    expect(bundle.format).toBe('xlsx');
    expect(bundle.fileName).toBe('statement.xlsx');
    expect(bundle.transactions).toHaveLength(2);
    expect(bundle.statementType).toBeNull();
    expect(bundle.statementSummary).toBeNull();
    expect(bundle.verificationInputs).toBeUndefined();
    expect(bundle.parsingErrors).toEqual([]);
    expect(bundle.rawText).toContain('Sheet: Sheet1');
  });

  it('extractStatementBundleFromFile keeps tabular imports on the neutral parser contract', async () => {
    const csvLines = [
      'Date,Description,Debit,Credit',
      '2024-01-20,Refund,,304',
    ];
    const file = createCsvFile(csvLines.join('\n'));

    const bundle = await extractStatementBundleFromFile({
      file,
      defaultCurrency: { code: 'INR', symbol: 'Rs.', name: 'Indian Rupee' },
    });

    expect(bundle.format).toBe('csv');
    expect(bundle.transactions).toHaveLength(1);
    expect(bundle.verificationInputs).toBeUndefined();
    expect(bundle.errors).toEqual([]);
  });

  it('extractStatementBundleFromFile requires explicit llm config for pdf parsing', async () => {
    const file = new File(['fake pdf'], 'statement.pdf', { type: 'application/pdf' });

    await expect(
      extractStatementBundleFromFile({
        file,
        defaultCurrency: { code: 'INR', symbol: 'Rs.', name: 'Indian Rupee' },
      }),
    ).rejects.toThrow('LLM runtime configuration is required for PDF statement parsing.');
  });
});
