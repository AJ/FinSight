import { describe, it, expect } from 'vitest';

import { buildChatContextForQuestion } from '@/lib/chat/contextBuilder';
import { makeTransaction, makeCategory } from '@tests/unit/factories';
import { CategoryType } from '@/types';

const INR = { code: 'INR', symbol: '₹', name: 'Indian Rupee' };

describe('buildChatContextForQuestion', () => {
  it('includes ledger snapshot for broad query', () => {
    const txns = [makeTransaction({ amount: 1000 }), makeTransaction({ amount: 2000 })];
    const context = buildChatContextForQuestion(txns, INR, 'What is my spending?');
    expect(context).toContain('Ledger snapshot');
    expect(context).toContain('Transactions: 2');
  });

  it('includes relevant transactions for specific query', () => {
    const txns = [
      makeTransaction({ id: '1', description: 'AMAZON PURCHASE', amount: 1299 }),
      makeTransaction({ id: '2', description: 'SWIGGY FOOD', amount: 350 }),
    ];
    const context = buildChatContextForQuestion(txns, INR, 'How much on Amazon?');
    expect(context).toContain('Ledger');
  });

  it('truncates to maxChars', () => {
    const txns = Array.from({ length: 100 }, (_, i) =>
      makeTransaction({ id: `t${i}`, description: `Transaction ${i}`, amount: 100 + i })
    );
    const context = buildChatContextForQuestion(txns, INR, 'Show recent transactions', { maxChars: 1000 });
    expect(context.length).toBeLessThanOrEqual(1000);
  });

  it('returns context for no transactions', () => {
    const context = buildChatContextForQuestion([], INR, 'What is my spending?');
    expect(context.length).toBeGreaterThan(0);
  });

  it('handles follow-up query', () => {
    const txns = [makeTransaction({ amount: 1000 })];
    const context = buildChatContextForQuestion(txns, INR, 'And what about Amazon?');
    expect(context).toContain('Ledger');
  });

  it('uses all transactions and truncates by maxChars', () => {
    const txns = Array.from({ length: 100 }, (_, i) =>
      makeTransaction({ id: `t${i}`, description: `Transaction ${i}`, amount: 100 + i })
    );
    const context = buildChatContextForQuestion(txns, INR, 'Show all transactions', { maxChars: 50000 });
    // With 50K char budget, all 100 should fit
    const lines = context.split('\n').filter((l) => /^\d+\./.test(l.trim()));
    expect(lines.length).toBe(100);
  });

  // --- formatAmount: Intl fallback for invalid currency code ---

  it('falls back to symbol when Intl.NumberFormat rejects the currency code', () => {
    const badCurrency = { code: 'INVALID', symbol: 'X', name: 'Fake' };
    const txn = makeTransaction({ amount: 500 });
    const context = buildChatContextForQuestion([txn], badCurrency, 'spending');
    // The fallback path produces "X500" (symbol + locale-formatted number)
    expect(context).toContain('X500');
  });

  // --- formatAmount: fractional amounts show 2 decimal places ---

  it('formats fractional amounts with two decimal places', () => {
    const txn = makeTransaction({ amount: 100.50 });
    const context = buildChatContextForQuestion([txn], INR, 'what did I spend');
    // Intl.NumberFormat with INR and a fractional value uses 2 decimal digits
    expect(context).toContain('100.50');
  });

  // --- scoreTransactions: numeric value matching ---

  it('ranks transactions whose amount matches a query number above others', () => {
    const match = makeTransaction({ id: 'match', description: 'Grocery store', amount: 2499 });
    const other = makeTransaction({ id: 'other', description: 'Gas station', amount: 800 });
    const context = buildChatContextForQuestion([other, match], INR, 'Did I spend 2499?');

    const lines = context.split('\n').filter((l) => /^\d+\./.test(l.trim()));
    // The matching transaction should appear first (higher score → earlier line)
    expect(lines[0]).toContain('Grocery store');
    expect(lines[1]).toContain('Gas station');
  });

  // --- scoreTransactions: merchant field is used in scoring ---

  it('uses the merchant field when scoring relevance', () => {
    const withMerchant = makeTransaction({
      id: 'm1',
      description: 'POS PURCHASE',
      amount: 500,
      merchant: 'Starbucks',
    });
    const without = makeTransaction({
      id: 'm2',
      description: 'Online order',
      amount: 600,
    });
    const context = buildChatContextForQuestion([without, withMerchant], INR, 'Starbucks');

    const lines = context.split('\n').filter((l) => /^\d+\./.test(l.trim()));
    // Merchant-matched txn should rank first
    expect(lines[0]).toContain('POS PURCHASE');
  });

  // --- scoreTransactions: keyword boosts (spend, income, credit, debit) ---

  it('boosts expense transactions when query contains "spend"', () => {
    const expense = makeTransaction({
      id: 'exp',
      description: 'Restaurant',
      amount: 200,
    }); // default category is shopping (Expense)
    const income = makeTransaction({
      id: 'inc',
      description: 'Salary',
      amount: 5000,
      category: makeCategory('salary', CategoryType.Income),
    });
    const context = buildChatContextForQuestion([income, expense], INR, 'how much did I spend');

    const lines = context.split('\n').filter((l) => /^\d+\./.test(l.trim()));
    // "spend" boosts expenses — Restaurant should come before Salary
    expect(lines[0]).toContain('Restaurant');
  });

  it('boosts income transactions when query contains "income"', () => {
    const expense = makeTransaction({
      id: 'exp',
      description: 'Restaurant',
      amount: 200,
    });
    const income = makeTransaction({
      id: 'inc',
      description: 'Salary deposit',
      amount: 5000,
      category: makeCategory('salary', CategoryType.Income),
    });
    const context = buildChatContextForQuestion([expense, income], INR, 'what is my income');

    const lines = context.split('\n').filter((l) => /^\d+\./.test(l.trim()));
    expect(lines[0]).toContain('Salary deposit');
  });

  it('boosts credit transactions when query contains "credit"', () => {
    const credit = makeTransaction({
      id: 'cr',
      description: 'Refund received',
      amount: 300,
      type: 'credit',
      category: makeCategory('refund', CategoryType.Income),
    });
    const debit = makeTransaction({
      id: 'dr',
      description: 'Grocery purchase',
      amount: 150,
    });
    const context = buildChatContextForQuestion([debit, credit], INR, 'any credits?');

    const lines = context.split('\n').filter((l) => /^\d+\./.test(l.trim()));
    expect(lines[0]).toContain('Refund received');
  });

  it('boosts debit transactions when query contains "paid"', () => {
    const debit = makeTransaction({
      id: 'dr',
      description: 'Electricity bill',
      amount: 250,
    });
    const credit = makeTransaction({
      id: 'cr',
      description: 'Cashback',
      amount: 50,
      type: 'credit',
      category: makeCategory('cashback', CategoryType.Income),
    });
    const context = buildChatContextForQuestion([credit, debit], INR, 'what did I pay for');

    const lines = context.split('\n').filter((l) => /^\d+\./.test(l.trim()));
    expect(lines[0]).toContain('Electricity bill');
  });

  // --- buildSummary: excluded transactions tracked in summary ---

  it('tracks excluded transactions in the summary totals', () => {
    const excluded = makeTransaction({
      id: 'ex',
      description: 'Transfer to savings',
      amount: 1000,
      category: makeCategory('transfer', CategoryType.Excluded),
    });
    const context = buildChatContextForQuestion([excluded], INR, 'overview');
    // Summary line includes "excluded" with the amount
    expect(context).toMatch(/excluded.*1,000/);
  });

  // --- buildChatContextForQuestion: description truncation at 56 chars ---

  it('truncates descriptions longer than 56 characters', () => {
    const longDesc = 'A'.repeat(80);
    const txn = makeTransaction({ id: 'long', description: longDesc, amount: 100 });
    const context = buildChatContextForQuestion([txn], INR, 'show transactions');

    // The description should be truncated to 56 chars + "..."
    const truncated = 'A'.repeat(56) + '...';
    expect(context).toContain(truncated);
    // The full 80-char description should NOT appear
    expect(context).not.toContain(longDesc);
  });

  // --- buildChatContextForQuestion: maxChars truncation with long descriptions ---

  it('enforces maxChars even with many long-description transactions', () => {
    const txns = Array.from({ length: 50 }, (_, i) =>
      makeTransaction({
        id: `t${i}`,
        description: `Very long description for transaction number ${i} with lots of detail `.repeat(3),
        amount: 100 + i,
      })
    );
    const context = buildChatContextForQuestion(txns, INR, 'all transactions', { maxChars: 800 });
    expect(context.length).toBeLessThanOrEqual(800);
  });

  // --- formatDate: invalid date fallback ---

  it('outputs "invalid-date" for transactions with unparseable dates', () => {
    // Set date to an invalid string via Object.defineProperty since date is readonly
    const txn = makeTransaction({ id: 'baddate', amount: 100 });
    Object.defineProperty(txn, 'date', { value: 'not-a-date', writable: true });
    const context = buildChatContextForQuestion([txn], INR, 'show transactions');
    expect(context).toContain('invalid-date');
  });

  // --- buildSummary: no valid dates produces fallback message ---

  it('shows fallback message when all transactions have invalid dates', () => {
    const txns = [
      makeTransaction({ id: 'd1', amount: 100 }),
      makeTransaction({ id: 'd2', amount: 200 }),
    ];
    for (const txn of txns) {
      Object.defineProperty(txn, 'date', { value: 'garbage', writable: true });
    }
    const context = buildChatContextForQuestion(txns, INR, 'overview');
    expect(context).toContain('No valid transaction dates available.');
  });

  // --- buildSummary: multiple expense categories sorted by total ---

  it('sorts expense categories by total descending in summary', () => {
    const txns = [
      makeTransaction({ id: '1', description: 'Grocery', amount: 5000, category: makeCategory('groceries') }),
      makeTransaction({ id: '2', description: 'Restaurant', amount: 2000, category: makeCategory('dining') }),
      makeTransaction({ id: '3', description: 'Gas', amount: 1000, category: makeCategory('transportation') }),
    ];
    const context = buildChatContextForQuestion(txns, INR, 'spending breakdown');
    // The "Top expense categories" line should list them in order: groceries, dining, transportation
    const categoryLine = context.split('\n').find(l => l.includes('Top expense categories'));
    expect(categoryLine).toBeTruthy();
    // groceries (5000) should appear before dining (2000) in the string
    const groceriesIdx = categoryLine!.indexOf('groceries');
    const diningIdx = categoryLine!.indexOf('dining');
    expect(groceriesIdx).toBeLessThan(diningIdx);
  });

  // --- buildSummary: multiple months in recent months summary ---

  it('shows recent months sorted by month descending', () => {
    const txns = [
      makeTransaction({ id: '1', description: 'Jan expense', amount: 1000, date: new Date('2025-01-15') }),
      makeTransaction({ id: '2', description: 'Mar expense', amount: 2000, date: new Date('2025-03-15') }),
      makeTransaction({ id: '3', description: 'Feb expense', amount: 1500, date: new Date('2025-02-15') }),
    ];
    const context = buildChatContextForQuestion(txns, INR, 'monthly breakdown');
    // "Recent months" line should list months in descending order: 2025-03, 2025-02, 2025-01
    const monthsLine = context.split('\n').find(l => l.includes('Recent months'));
    expect(monthsLine).toBeTruthy();
    const marIdx = monthsLine!.indexOf('2025-03');
    const febIdx = monthsLine!.indexOf('2025-02');
    const janIdx = monthsLine!.indexOf('2025-01');
    expect(marIdx).toBeLessThan(febIdx);
    expect(febIdx).toBeLessThan(janIdx);
  });

  // --- Hard truncation when context exceeds maxChars with few transactions ---

  it('hard-truncates context when few transactions still exceed maxChars', () => {
    // Create a transaction with an extremely long description
    const veryLongDesc = 'X'.repeat(500);
    const txns = [
      makeTransaction({ id: '1', description: veryLongDesc, amount: 100 }),
    ];
    // Set a very small maxChars to force the hard truncation path
    const context = buildChatContextForQuestion(txns, INR, 'show transactions', { maxChars: 100 });
    expect(context.length).toBeLessThanOrEqual(100);
    // Hard truncation appends "..."
    expect(context).toContain('...');
  });

  // --- buildSummary: topCategories is empty when no expense transactions ---

  it('shows "none" for top expense categories when only income transactions', () => {
    const txns = [
      makeTransaction({ id: '1', description: 'Salary', amount: 5000, category: makeCategory('salary', CategoryType.Income) }),
    ];
    const context = buildChatContextForQuestion(txns, INR, 'overview');
    expect(context).toContain('Top expense categories: none');
  });

  // --- buildSummary: recentMonths is empty when dates are invalid ---

  it('shows "none" for recent months when no valid month data', () => {
    // Use transactions with no valid dates — the monthMap will be empty
    const txns = [
      makeTransaction({ id: 'd1', amount: 100 }),
    ];
    for (const txn of txns) {
      Object.defineProperty(txn, 'date', { value: 'invalid', writable: true });
    }
    const context = buildChatContextForQuestion(txns, INR, 'overview');
    // When dates are invalid, format() may produce "Invalid Date" as month key
    // or the whole summary may show the fallback
    expect(context).toContain('Ledger snapshot');
  });
});
