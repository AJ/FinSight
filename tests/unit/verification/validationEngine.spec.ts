import { describe, it, expect } from 'vitest';
import { validateCCSummary, validateBankSummary, validateTransactions } from '@/lib/verification/validationEngine';

// ─── CC Summary Validation ─────────────────────────────────────────────────

describe('validateCCSummary', () => {
  it('passes a complete valid CC summary', () => {
    const result = validateCCSummary({
      statementDate: '2024-01-31',
      paymentDueDate: '2024-02-15',
      creditLimit: 100000,
      totalDue: 25000,
      minimumDue: 2500,
      availableCredit: 75000,
      previousBalance: 30000,
      paymentsReceived: 10000,
      purchasesAndCharges: 25000,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('passes with all fields null', () => {
    const result = validateCCSummary({
      statementDate: null,
      paymentDueDate: null,
      creditLimit: null,
      totalDue: null,
      minimumDue: null,
      availableCredit: null,
      previousBalance: null,
      paymentsReceived: null,
      purchasesAndCharges: null,
    });
    // null is allowed per schema — no errors expected
    expect(result.valid).toBe(true);
  });

  it('rejects null/undefined summary', () => {
    expect(validateCCSummary(null).valid).toBe(false);
    expect(validateCCSummary(undefined).valid).toBe(false);
  });

  it('rejects missing summary', () => {
    const result = validateCCSummary(undefined);
    expect(result.errors).toContain('Summary is missing');
  });

  it('rejects invalid statementDate format', () => {
    const result = validateCCSummary({
      statementDate: 'not-a-date',
      creditLimit: 100000,
      totalDue: 0,
      minimumDue: 0,
      availableCredit: 100000,
      previousBalance: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('statementDate'))).toBe(true);
  });

  it('accepts DD/MM/YYYY date format', () => {
    const result = validateCCSummary({
      statementDate: '31/01/2024',
      creditLimit: 100000,
    });
    expect(result.valid).toBe(true);
  });

  it('accepts Mon DD, YYYY date format', () => {
    const result = validateCCSummary({
      statementDate: '31 Jan 2024',
      creditLimit: 100000,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects invalid date that regex matches but has bad values', () => {
    const result = validateCCSummary({
      statementDate: '13/13/2024',
      creditLimit: 100000,
    });
    expect(result.valid).toBe(false);
  });

  it('rejects negative totalDue', () => {
    const result = validateCCSummary({ totalDue: -100 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('totalDue'))).toBe(true);
  });

  it('rejects negative minimumDue', () => {
    const result = validateCCSummary({ minimumDue: -50 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('minimumDue'))).toBe(true);
  });

  it('rejects negative creditLimit', () => {
    const result = validateCCSummary({ creditLimit: -50000 });
    expect(result.valid).toBe(false);
  });

  it('rejects negative availableCredit', () => {
    const result = validateCCSummary({ availableCredit: -1000 });
    expect(result.valid).toBe(false);
  });

  it('rejects negative previousBalance', () => {
    const result = validateCCSummary({ previousBalance: -100 });
    expect(result.valid).toBe(false);
  });

  it('rejects negative paymentsReceived', () => {
    const result = validateCCSummary({ paymentsReceived: -500 });
    expect(result.valid).toBe(false);
  });

  it('rejects negative purchasesAndCharges', () => {
    const result = validateCCSummary({ purchasesAndCharges: -1000 });
    expect(result.valid).toBe(false);
  });

  it('rejects totalDue < minimumDue', () => {
    const result = validateCCSummary({
      totalDue: 100,
      minimumDue: 500,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('totalDue'))).toBe(true);
  });

  it('passes when totalDue equals minimumDue', () => {
    const result = validateCCSummary({
      totalDue: 500,
      minimumDue: 500,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects availableCredit > creditLimit', () => {
    const result = validateCCSummary({
      availableCredit: 120000,
      creditLimit: 100000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('availableCredit'))).toBe(true);
  });

  it('passes when availableCredit equals creditLimit', () => {
    const result = validateCCSummary({
      availableCredit: 100000,
      creditLimit: 100000,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects previousBalance > creditLimit', () => {
    const result = validateCCSummary({
      previousBalance: 150000,
      creditLimit: 100000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('previousBalance'))).toBe(true);
  });

  it('passes when previousBalance equals creditLimit', () => {
    const result = validateCCSummary({
      previousBalance: 100000,
      creditLimit: 100000,
    });
    expect(result.valid).toBe(true);
  });

  it('catches multiple errors at once', () => {
    const result = validateCCSummary({
      totalDue: -100,
      minimumDue: 500,
      availableCredit: 200000,
      creditLimit: 100000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('handles LLM hallucinated extra fields gracefully', () => {
    const result = validateCCSummary({
      statementDate: '2024-01-31',
      creditLimit: 100000,
      totalDue: 25000,
      hallucinatedField: 'some value',
      advice: 'You should save more money',
    });
    // Extra fields should not cause errors — only defined fields are validated
    expect(result.valid).toBe(true);
  });

  it('rejects invalid month name in date (e.g. "15 Xyz 2024")', () => {
    const result = validateCCSummary({
      statementDate: '15 Xyz 2024',
      creditLimit: 100000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('statementDate'))).toBe(true);
  });

  it('rejects month-name date with day > 31', () => {
    const result = validateCCSummary({
      statementDate: '32 Jan 2024',
      creditLimit: 100000,
    });
    expect(result.valid).toBe(false);
  });

  it('rejects month-name date with invalid day for month (Feb 30)', () => {
    const result = validateCCSummary({
      statementDate: '30 Feb 2024',
      creditLimit: 100000,
    });
    expect(result.valid).toBe(false);
  });

  it('rejects invalid paymentDueDate format', () => {
    const result = validateCCSummary({
      statementDate: '2024-01-31',
      paymentDueDate: 'garbage-date',
      creditLimit: 100000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('paymentDueDate'))).toBe(true);
  });

  it('accepts MM-DD-YYYY date format when second part > 12', () => {
    // "01-15-2024": first=01 <= 12, second=15 > 12 → MM/DD/YYYY interpretation
    const result = validateCCSummary({
      statementDate: '01-15-2024',
      creditLimit: 100000,
    });
    expect(result.valid).toBe(true);
  });

  it('accepts DD/MM/YYYY when first part > 12', () => {
    // "15/01/2024": first=15 > 12 → DD/MM/YYYY interpretation
    const result = validateCCSummary({
      statementDate: '15/01/2024',
      creditLimit: 100000,
    });
    expect(result.valid).toBe(true);
  });

  it('accepts ambiguous DD/MM/YYYY when both parts <= 12', () => {
    // "05/06/2024": both <= 12, ambiguous → defaults to DD/MM/YYYY
    const result = validateCCSummary({
      statementDate: '05/06/2024',
      creditLimit: 100000,
    });
    expect(result.valid).toBe(true);
  });

  it('accepts 2-digit year format', () => {
    // "25-01-15": first part length != 4, last part length != 4 → 2-digit year branch
    // parts[0] < 100 → +2000 → year 2025
    const result = validateCCSummary({
      statementDate: '25-06-15',
      creditLimit: 100000,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects "25-13-15" — month 13 is invalid regardless of interpretation', () => {
    // Primary parser: a=25 > 12 → DMY → day=25, month=13 → month > 11 → null
    // Old parser: YY-MM-DD → year=2025, month=13 → invalid
    // Both correctly reject it.
    const result = validateCCSummary({
      statementDate: '25-13-15',
      creditLimit: 100000,
    });
    expect(result.valid).toBe(false);
  });

  it('parses 2-digit-year date "25-01-32" as DMY (Jan 25, 2032)', () => {
    // The primary parser uses heuristic: first value > 12 → it's a day → DMY format.
    // "25-01-32" → day=25, month=01, year=2032
    const result = validateCCSummary({
      statementDate: '25-01-32',
      creditLimit: 100000,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects genuinely invalid date "32-01-15" (day > 31)', () => {
    // "32-01-15" → day=32 (invalid, >31)
    const result = validateCCSummary({
      statementDate: '32-01-15',
      creditLimit: 100000,
    });
    expect(result.valid).toBe(false);
  });

  it('rejects Feb 30 as statementDate', () => {
    const result = validateCCSummary({
      statementDate: '2024-02-30',
      creditLimit: 100000,
    });
    expect(result.valid).toBe(false);
  });

  it('accepts zero-value summary', () => {
    const result = validateCCSummary({
      creditLimit: 0,
      totalDue: 0,
      minimumDue: 0,
      availableCredit: 0,
      previousBalance: 0,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects string amounts in summary fields', () => {
    const result = validateCCSummary({
      totalDue: '25000', // LLM returned string instead of number
      creditLimit: 100000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('totalDue') && e.includes('number'))).toBe(true);
  });
});

// ─── Bank Summary Validation ────────────────────────────────────────────────

describe('validateBankSummary', () => {
  it('passes a complete valid bank summary', () => {
    const result = validateBankSummary({
      statementDate: '2024-01-31',
      statementPeriodStart: '2024-01-01',
      statementPeriodEnd: '2024-01-31',
      openingBalance: 50000,
      closingBalance: 75000,
    });
    expect(result.valid).toBe(true);
  });

  it('passes with all null fields', () => {
    const result = validateBankSummary({
      statementDate: null,
      statementPeriodStart: null,
      statementPeriodEnd: null,
      openingBalance: null,
      closingBalance: null,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects null/undefined summary', () => {
    expect(validateBankSummary(null).valid).toBe(false);
    expect(validateBankSummary(undefined).valid).toBe(false);
  });

  it('rejects invalid statementDate', () => {
    const result = validateBankSummary({ statementDate: 'bad-date' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('statementDate'))).toBe(true);
  });

  it('rejects invalid statementPeriodStart', () => {
    const result = validateBankSummary({ statementPeriodStart: '31/13/2024' });
    expect(result.valid).toBe(false);
  });

  it('accepts negative openingBalance (overdraft)', () => {
    const result = validateBankSummary({ openingBalance: -5000 });
    expect(result.valid).toBe(true);
  });

  it('rejects string amounts in balance fields', () => {
    const result = validateBankSummary({
      openingBalance: '10000', // LLM returned string instead of number
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('openingBalance') && e.includes('number'))).toBe(true);
  });

  it('accepts negative closingBalance (overdraft)', () => {
    const result = validateBankSummary({ closingBalance: -2000 });
    expect(result.valid).toBe(true);
  });

  it('rejects periodEnd before periodStart date-wise', () => {
    const result = validateBankSummary({
      statementPeriodStart: '2024-01-31',
      statementPeriodEnd: '2024-01-01',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('statementPeriodEnd'))).toBe(true);
  });

  it('handles empty object', () => {
    const result = validateBankSummary({});
    expect(result.valid).toBe(true);
  });

  it('handles LLM hallucinated fields', () => {
    const result = validateBankSummary({
      statementDate: '2024-01-31',
      randomField: 'should be ignored',
    });
    expect(result.valid).toBe(true);
  });
});

// ─── Transaction Validation ─────────────────────────────────────────────────

describe('validateTransactions', () => {
  it('passes a valid transaction array', () => {
    const result = validateTransactions([
      { date: '2024-01-15', description: 'AMAZON', amount: 1299, type: 'debit' },
      { date: '2024-01-20', description: 'SALARY', amount: 50000, type: 'credit' },
    ]);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.data!.transactions).toHaveLength(2);
  });

  it('passes wrapped { transactions: [...] } format', () => {
    const result = validateTransactions({
      transactions: [
        { date: '2024-01-15', description: 'AMAZON', amount: 1299, type: 'debit' },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.data!.transactions).toHaveLength(1);
  });

  it('rejects non-array data', () => {
    const result = validateTransactions({ notTransactions: [] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('transactions must be an array');
  });

  it('rejects empty non-array object', () => {
    const result = validateTransactions({});
    expect(result.valid).toBe(false);
  });

  it('accepts empty array', () => {
    const result = validateTransactions([]);
    expect(result.valid).toBe(true);
    expect(result.data!.transactions).toEqual([]);
  });

  it('rejects transaction with missing date', () => {
    const result = validateTransactions([
      { description: 'AMAZON', amount: 1299, type: 'debit' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('date is missing'))).toBe(true);
  });

  it('rejects transaction with non-string date', () => {
    const result = validateTransactions([
      { date: new Date('2024-01-15'), description: 'AMAZON', amount: 1299, type: 'debit' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('date must be a string'))).toBe(true);
  });

  it('warns on unparseable date but does not reject', () => {
    const result = validateTransactions([
      { date: 'not-a-date', description: 'AMAZON', amount: 1299, type: 'debit' },
    ]);
    // Date warning should NOT make the transaction invalid
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('date'))).toBe(true);
    expect(result.data!.transactions).toHaveLength(1);
  });

  it('rejects transaction with string amount (common LLM bug)', () => {
    const result = validateTransactions([
      { date: '2024-01-15', description: 'AMAZON', amount: '1299', type: 'debit' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('amount'))).toBe(true);
  });

  it('rejects transaction with NaN amount', () => {
    const result = validateTransactions([
      { date: '2024-01-15', description: 'AMAZON', amount: NaN, type: 'debit' },
    ]);
    expect(result.valid).toBe(false);
  });

  it('rejects transaction with negative amount', () => {
    const result = validateTransactions([
      { date: '2024-01-15', description: 'AMAZON', amount: -1299, type: 'debit' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('amount must be > 0'))).toBe(true);
  });

  it('rejects transaction with zero amount', () => {
    const result = validateTransactions([
      { date: '2024-01-15', description: 'AMAZON', amount: 0, type: 'debit' },
    ]);
    expect(result.valid).toBe(false);
  });

  it('warns but does not reject noise row "Opening Balance"', () => {
    const result = validateTransactions([
      { date: '2024-01-15', description: 'Opening Balance', amount: 50000, type: 'credit' },
    ]);
    expect(result.valid).toBe(true); // Warning only
    expect(result.warnings.some(w => w.includes('Opening Balance'))).toBe(true);
    expect(result.data!.transactions).toHaveLength(0); // Skipped from valid list
  });

  it('warns on noise row "Closing Balance" (case insensitive)', () => {
    const result = validateTransactions([
      { date: '2024-01-31', description: '  CLOSING BALANCE  ', amount: 75000, type: 'credit' },
    ]);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('CLOSING BALANCE'))).toBe(true);
    expect(result.data!.transactions).toHaveLength(0);
  });

  it('warns on noise row "Total Debit"', () => {
    const result = validateTransactions([
      { date: '2024-01-31', description: 'Total Debit', amount: 50000, type: 'debit' },
    ]);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('Total Debit'))).toBe(true);
    expect(result.data!.transactions).toHaveLength(0);
  });

  it('warns on noise row "Total Credit"', () => {
    const result = validateTransactions([
      { date: '2024-01-31', description: 'Total Credit', amount: 30000, type: 'credit' },
    ]);
    expect(result.valid).toBe(true);
    expect(result.data!.transactions).toHaveLength(0);
  });

  it('warns on noise row "Subtotal"', () => {
    const result = validateTransactions([
      { date: '2024-01-31', description: 'Subtotal', amount: 80000, type: 'credit' },
    ]);
    expect(result.valid).toBe(true);
    expect(result.data!.transactions).toHaveLength(0);
  });

  it('warns on noise row "Sub-total" (hyphenated)', () => {
    const result = validateTransactions([
      { date: '2024-01-31', description: 'Sub-total', amount: 80000, type: 'credit' },
    ]);
    expect(result.valid).toBe(true);
    expect(result.data!.transactions).toHaveLength(0);
  });

  it('warns on noise row "Balance b/f"', () => {
    const result = validateTransactions([
      { date: '2024-01-01', description: 'Balance b/f', amount: 50000, type: 'credit' },
    ]);
    expect(result.valid).toBe(true);
    expect(result.data!.transactions).toHaveLength(0);
  });

  it('warns on noise row "Total purchases for the period"', () => {
    const result = validateTransactions([
      { date: '2024-01-31', description: 'Total purchases for the period', amount: 25000, type: 'debit' },
    ]);
    expect(result.valid).toBe(true);
    expect(result.data!.transactions).toHaveLength(0);
  });

  it('does NOT reject legitimate transaction with "opening" in description', () => {
    // "Opening Ceremony Purchase at Amazon" is a real transaction
    const result = validateTransactions([
      { date: '2024-01-15', description: 'Opening Ceremony Purchase', amount: 1299, type: 'debit' },
    ]);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('Opening'))).toBe(false);
    expect(result.data!.transactions).toHaveLength(1);
  });

  it('handles mixed valid, invalid, and noise transactions', () => {
    const result = validateTransactions([
      { date: '2024-01-15', description: 'AMAZON', amount: 1299, type: 'debit' },       // valid
      { description: 'NO DATE', amount: 500, type: 'debit' },                             // missing date → error
      { date: '2024-01-20', description: 'SWIGGY', amount: '350', type: 'debit' },        // string amount → error
      { date: '2024-01-31', description: 'Closing Balance', amount: 75000, type: 'credit' }, // noise → warning
      { date: '2024-01-25', description: 'NETFLIX', amount: 649, type: 'debit' },         // valid
    ]);
    expect(result.valid).toBe(false); // Has errors
    expect(result.errors.length).toBe(2); // Missing date + string amount
    expect(result.warnings.length).toBe(1); // Noise row
    expect(result.data!.transactions).toHaveLength(2); // AMAZON + NETFLIX
  });

  it('handles transaction with missing description', () => {
    const result = validateTransactions([
      { date: '2024-01-15', amount: 1299, type: 'debit' },
    ]);
    // Missing description is not rejected — only date and amount are required
    expect(result.valid).toBe(true);
    expect(result.data!.transactions).toHaveLength(1);
  });

  it('rejects transaction with missing amount', () => {
    const result = validateTransactions([
      { date: '2024-01-15', description: 'AMAZON', type: 'debit' },
    ]);
    expect(result.valid).toBe(false);
  });

  it('handles date with pipe artifact "2025-10-04|00:00"', () => {
    const result = validateTransactions([
      { date: '2025-10-04|00:00', description: 'AMAZON', amount: 1299, type: 'debit' },
    ]);
    expect(result.valid).toBe(true);
  });

  it('warns when originalCurrency set but originalAmount missing', () => {
    const result = validateTransactions([
      { date: '2024-01-15', description: 'AMAZON', amount: 1299, type: 'debit', originalCurrency: 'USD' },
    ]);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('originalCurrency') && w.includes('originalAmount'))).toBe(true);
    expect(result.data!.transactions).toHaveLength(1);
  });

  it('warns when originalAmount set but originalCurrency missing', () => {
    const result = validateTransactions([
      { date: '2024-01-15', description: 'AMAZON', amount: 1299, type: 'debit', originalAmount: 15.99 },
    ]);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('originalAmount') && w.includes('originalCurrency'))).toBe(true);
    expect(result.data!.transactions).toHaveLength(1);
  });

  it('passes when both originalCurrency and originalAmount are set', () => {
    const result = validateTransactions([
      { date: '2024-01-15', description: 'AMAZON', amount: 1299, type: 'debit', originalCurrency: 'USD', originalAmount: 15.99 },
    ]);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('originalCurrency') || w.includes('originalAmount'))).toBe(false);
  });

  it('passes when neither originalCurrency nor originalAmount are set', () => {
    const result = validateTransactions([
      { date: '2024-01-15', description: 'AMAZON', amount: 1299, type: 'debit' },
    ]);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('originalCurrency') || w.includes('originalAmount'))).toBe(false);
  });

  it('warns when isInternationalTransaction is true but originalCurrency is missing', () => {
    const result = validateTransactions([
      { date: '2024-01-15', description: 'AMAZON', amount: 1299, type: 'debit', isInternationalTransaction: true },
    ]);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('international') && w.includes('originalCurrency'))).toBe(true);
  });
});
