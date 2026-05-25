import { describe, it, expect } from 'vitest';

import { parseCSV } from '@/lib/parsers/csvParser';
import { makeCsvFile } from '../factories';

const BANK_CSV = `Date,Description,Debit,Credit,Balance
01/01/2024,Grocery Store,50.00,,950.00
02/01/2024,Salary,,3000.00,3950.00
03/01/2024,Gas Station,40.00,,3910.00`;

const AMOUNT_ONLY_CSV = `Date,Description,Amount
01/01/2024,Grocery,-50.00
02/01/2024,Salary,3000.00`;

const TYPE_COLUMN_CSV = `Date,Details,Amount,Type
01/01/2024,Coffee,5.00,debit
02/01/2024,Refund,15.00,credit`;

const NARRATION_CSV = `Txn Date,Narration,Withdrawal,Deposit
01/01/2024,ATM Withdrawal,2000.00,
02/01/2024,NEFT Transfer,,50000.00`;

describe('parseCSV', () => {
  it('parses bank CSV with debit/credit columns', async () => {
    const result = await parseCSV(makeCsvFile(BANK_CSV));

    expect(result.transactions).toHaveLength(3);
    expect(result.format).toBe('csv');
    expect(result.statementType).toBeNull();

    const grocery = result.transactions[0];
    expect(grocery.amount).toBe(50);
    expect(grocery.description).toBe('Grocery Store');

    const salary = result.transactions[1];
    expect(salary.amount).toBe(3000);
  });

  it('parses CSV with single Amount column and sign-based type', async () => {
    const result = await parseCSV(makeCsvFile(AMOUNT_ONLY_CSV));

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].amount).toBe(50);
    expect(result.transactions[0].isDebit).toBe(true);
    expect(result.transactions[1].amount).toBe(3000);
    expect(result.transactions[1].isCredit).toBe(true);
  });

  it('parses CSV with Type column', async () => {
    const result = await parseCSV(makeCsvFile(TYPE_COLUMN_CSV));

    expect(result.transactions).toHaveLength(2);
  });

  it('parses alternate header names (Narration, Withdrawal, Deposit)', async () => {
    const result = await parseCSV(makeCsvFile(NARRATION_CSV));

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].description).toBe('ATM Withdrawal');
    expect(result.transactions[1].description).toBe('NEFT Transfer');
  });

  it('throws on empty CSV', async () => {
    const csv = 'Date,Description,Amount\n';
    await expect(parseCSV(makeCsvFile(csv))).rejects.toThrow('empty');
  });

  it('throws when no date column found', async () => {
    const csv = 'Description,Amount\nGrocery,50.00\n';
    await expect(parseCSV(makeCsvFile(csv))).rejects.toThrow('date column');
  });

  it('throws when no amount columns found', async () => {
    const csv = 'Date,Description\n01/01/2024,Grocery\n';
    await expect(parseCSV(makeCsvFile(csv))).rejects.toThrow('amount');
  });

  it('handles parenthesized negative amounts', async () => {
    const csv = `Date,Description,Amount
01/01/2024,Refund,(50.00)
02/01/2024,Purchase,100.00`;

    const result = await parseCSV(makeCsvFile(csv));
    expect(result.transactions).toHaveLength(2);
  });

  it('skips rows with empty amounts', async () => {
    const csv = `Date,Description,Debit,Credit
01/01/2024,Grocery,50.00,
02/01/2024,Empty,,
03/01/2024,Salary,,3000.00`;

    const result = await parseCSV(makeCsvFile(csv));
    expect(result.transactions).toHaveLength(2);
  });

  it('populates fileName from input file', async () => {
    const result = await parseCSV(makeCsvFile(BANK_CSV));
    expect(result.fileName).toBe('test.csv');
  });

  it('includes rawText in result', async () => {
    const result = await parseCSV(makeCsvFile(BANK_CSV));
    expect(result.rawText).toBe(BANK_CSV);
  });

  it('sets statementType when provided via options', async () => {
    const result = await parseCSV(
      makeCsvFile(BANK_CSV),
      { statementType: 'credit_card' },
    );
    expect(result.statementType).toBe('credit_card');
  });

  it('strips currency symbols from amounts', async () => {
    const csv = `Date,Description,Amount
01/01/2024,Store,₹150.00
02/01/2024,Gas,$40.00`;

    const result = await parseCSV(makeCsvFile(csv));
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].amount).toBe(150);
    expect(result.transactions[1].amount).toBe(40);
  });

  it('handles European number format (comma decimal)', async () => {
    const csv = `Date,Description,Debit,Credit
01/01/2024,Store,"1.234,56",
02/01/2024,Gas,,"40,50"`;

    const result = await parseCSV(makeCsvFile(csv));

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].amount).toBe(1234.56);
    expect(result.transactions[1].amount).toBe(40.50);
  });

  it('defaults description to "Transaction" when empty', async () => {
    const csv = `Date,Description,Debit,Credit
01/01/2024,,50.00,`;

    const result = await parseCSV(makeCsvFile(csv));
    expect(result.transactions[0].description).toBe('Transaction');
  });

  it('captures balance when balance column present', async () => {
    const result = await parseCSV(makeCsvFile(BANK_CSV));
    expect(result.transactions[0].balance).toBe(950);
    expect(result.transactions[1].balance).toBe(3950);
  });

  it('excludes balance when no balance column', async () => {
    const result = await parseCSV(makeCsvFile(AMOUNT_ONLY_CSV));
    expect(result.transactions[0].balance).toBeUndefined();
  });

  it('skips rows with "null" string in amount', async () => {
    const csv = `Date,Description,Debit,Credit
01/01/2024,Valid,50.00,
02/01/2024,BadRow,null,`;

    const result = await parseCSV(makeCsvFile(csv));

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].description).toBe('Valid');
  });

  it('skips rows with "--" in amount', async () => {
    const csv = `Date,Description,Debit,Credit
01/01/2024,Valid,50.00,
02/01/2024,BadRow,--,`;

    const result = await parseCSV(makeCsvFile(csv));

    expect(result.transactions).toHaveLength(1);
  });

  it('resolves debit/credit type from Type column', async () => {
    const result = await parseCSV(makeCsvFile(TYPE_COLUMN_CSV));

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].isDebit).toBe(true);
    expect(result.transactions[0].amount).toBe(5);
    expect(result.transactions[1].isCredit).toBe(true);
    expect(result.transactions[1].amount).toBe(15);
  });

  it('recognizes type column value "dr" as debit', async () => {
    const csv = `Date,Description,Amount,Type
01/01/2024,ATM,100.00,dr`;
    const result = await parseCSV(makeCsvFile(csv));
    expect(result.transactions[0].isDebit).toBe(true);
  });

  it('recognizes type column value "withdrawal" as debit', async () => {
    const csv = `Date,Description,Amount,Type
01/01/2024,ATM,100.00,withdrawal`;
    const result = await parseCSV(makeCsvFile(csv));
    expect(result.transactions[0].isDebit).toBe(true);
  });

  it('recognizes type column value "expense" as debit', async () => {
    const csv = `Date,Description,Amount,Type
01/01/2024,Coffee,5.00,expense`;
    const result = await parseCSV(makeCsvFile(csv));
    expect(result.transactions[0].isDebit).toBe(true);
  });

  it('recognizes type column value "cr" as credit', async () => {
    const csv = `Date,Description,Amount,Type
01/01/2024,Refund,50.00,cr`;
    const result = await parseCSV(makeCsvFile(csv));
    expect(result.transactions[0].isCredit).toBe(true);
  });

  it('recognizes type column value "deposit" as credit', async () => {
    const csv = `Date,Description,Amount,Type
01/01/2024,Salary,3000.00,deposit`;
    const result = await parseCSV(makeCsvFile(csv));
    expect(result.transactions[0].isCredit).toBe(true);
  });

  it('recognizes type column value "income" as credit', async () => {
    const csv = `Date,Description,Amount,Type
01/01/2024,Salary,3000.00,income`;
    const result = await parseCSV(makeCsvFile(csv));
    expect(result.transactions[0].isCredit).toBe(true);
  });

  it('falls back to sign-based type for unrecognized type column value', async () => {
    const csv = `Date,Description,Amount,Type
01/01/2024,Refund,-50.00,misc`;
    const result = await parseCSV(makeCsvFile(csv));
    expect(result.transactions[0].isDebit).toBe(true);
    expect(result.transactions[0].amount).toBe(50);
  });

  it('parses CSV with only a credit/deposit column (no debit column)', async () => {
    const csv = `Date,Description,Deposit
01/01/2024,Salary,3000.00
02/01/2024,Refund,150.00`;
    const result = await parseCSV(makeCsvFile(csv));
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].isCredit).toBe(true);
    expect(result.transactions[0].amount).toBe(3000);
  });

  it('populates warnings when PapaParse encounters errors', async () => {
    // Unclosed quote triggers PapaParse Quotes/MissingQuotes + FieldMismatch errors
    const csv = `Date,Description,Amount,Type
01/01/2024,Valid,100.00,debit
02/01/2024,"Unclosed quote,300.00,credit`;

    const result = await parseCSV(makeCsvFile(csv));

    expect(result.parsingErrors.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('failed to parse');
  });

  it('sets sourceType to CreditCard when statementType is credit_card', async () => {
    const result = await parseCSV(
      makeCsvFile(BANK_CSV),
      { statementType: 'credit_card' },
    );
    expect(result.transactions[0].sourceType).toBe('credit_card');
  });

  it('handles comma-as-thousands separator in large numbers', async () => {
    const csv = `Date,Description,Amount
01/01/2024,Large Purchase,"1,234,567"`;
    const result = await parseCSV(makeCsvFile(csv));
    expect(result.transactions[0].amount).toBe(1234567);
  });

  it('populates parsingErrors from malformed rows', async () => {
    const csv = `Date,Description,Debit,Credit
not-a-date,Grocery,50.00,
02/01/2024,Salary,,3000.00`;

    const result = await parseCSV(makeCsvFile(csv));

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].description).toBe('Salary');
  });

  // ── Debit-only column (no credit column) branch ────────────────────────────

  it('parses CSV with only a debit/withdrawal column (no credit column)', async () => {
    const csv = `Date,Description,Withdrawal
01/01/2024,Grocery,50.00
02/01/2024,Gas,40.00`;
    const result = await parseCSV(makeCsvFile(csv));
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].isDebit).toBe(true);
    expect(result.transactions[0].amount).toBe(50);
    expect(result.transactions[1].isDebit).toBe(true);
    expect(result.transactions[1].amount).toBe(40);
  });

  it('skips rows with zero amount in debit-only column', async () => {
    const csv = `Date,Description,Withdrawal
01/01/2024,Valid,50.00
02/01/2024,Zero,0.00
03/01/2024,Also,30.00`;
    const result = await parseCSV(makeCsvFile(csv));
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].description).toBe('Valid');
    expect(result.transactions[1].description).toBe('Also');
  });

  it('skips rows with empty amount in debit-only column', async () => {
    const csv = `Date,Description,Debit
01/01/2024,Valid,50.00
02/01/2024,Empty,
03/01/2024,Also,30.00`;
    const result = await parseCSV(makeCsvFile(csv));
    expect(result.transactions).toHaveLength(2);
  });
});
