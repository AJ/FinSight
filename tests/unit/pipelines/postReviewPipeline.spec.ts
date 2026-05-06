import { describe, it, expect, vi, beforeEach } from 'vitest';
import { finalizeReviewImport } from '@/lib/pipelines/postReviewPipeline';
import { reviewSessionRepository } from '@/lib/review/reviewSessionRepository';
import { CategorizedBy } from '@/types';
import type { Summary } from '@/lib/parsers/extractSummary';
import '@/lib/categorization/categories';
import { makeTransaction, makeCategory } from '@tests/unit/factories';

const INR = { code: 'INR', symbol: '₹', name: 'Indian Rupee' };

describe('finalizeReviewImport', () => {
  const defaultDependencies = {
    addTransactions: vi.fn(),
    addCreditCardStatement: vi.fn(),
  };

  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('throws when no review session exists', async () => {
    await expect(
      finalizeReviewImport([], defaultDependencies),
    ).rejects.toThrow('No staged review session found');
  });

  it('adds reviewed transactions to the store', async () => {
    const original = makeTransaction({ id: 'txn-1', description: 'Coffee Shop', amount: 250 });

    reviewSessionRepository.save({
      transactions: [original],
      currency: INR,
      format: 'csv',
      statementType: 'bank',
      fileName: 'test.csv',
      parseDate: new Date(),
      statementSummary: null,
      warnings: [],
    });

    const reviewed = makeTransaction({ id: 'txn-1', description: 'Coffee Shop', amount: 250 });
    const result = await finalizeReviewImport([reviewed], defaultDependencies);

    expect(defaultDependencies.addTransactions).toHaveBeenCalledWith([reviewed]);
    expect(result.importedCount).toBe(1);
  });

  it('learns merchant rules when user manually changes category', async () => {
    const original = makeTransaction({
      id: 'txn-1', description: 'Coffee Shop', amount: 250,
      category: makeCategory('shopping'), categorizedBy: CategorizedBy.AI,
    });
    const reviewed = makeTransaction({
      id: 'txn-1', description: 'Coffee Shop', amount: 250,
      category: makeCategory('dining'), categorizedBy: CategorizedBy.Manual,
    });

    reviewSessionRepository.save({
      transactions: [original],
      currency: INR,
      format: 'csv',
      statementType: 'bank',
      fileName: 'test.csv',
      parseDate: new Date(),
      statementSummary: null,
      warnings: [],
    });

    const result = await finalizeReviewImport([reviewed], defaultDependencies);
    expect(typeof result.learnedRuleUpdates).toBe('number');
  });

  it('does not learn rules when category unchanged', async () => {
    const original = makeTransaction({
      id: 'txn-1', description: 'Coffee Shop', amount: 250,
      category: makeCategory('shopping'), categorizedBy: CategorizedBy.AI,
    });
    const reviewed = makeTransaction({
      id: 'txn-1', description: 'Coffee Shop', amount: 250,
      category: makeCategory('shopping'), categorizedBy: CategorizedBy.Manual,
    });

    reviewSessionRepository.save({
      transactions: [original],
      currency: INR,
      format: 'csv',
      statementType: 'bank',
      fileName: 'test.csv',
      parseDate: new Date(),
      statementSummary: null,
      warnings: [],
    });

    const result = await finalizeReviewImport([reviewed], defaultDependencies);
    expect(result.learnedRuleUpdates).toBe(0);
  });

  it('creates CC statement for credit card statements', async () => {
    const reviewed = makeTransaction({ id: 'txn-1', description: 'Amazon', amount: 1299 });

    reviewSessionRepository.save({
      transactions: [reviewed],
      currency: INR,
      format: 'pdf',
      statementType: 'credit_card',
      fileName: 'cc-statement.pdf',
      parseDate: new Date(),
      statementSummary: {
        statementDate: '2025-10-31',
        paymentDueDate: '2025-11-15',
        totalDue: 1299,
        minimumDue: 130,
        previousBalance: 0,
        creditLimit: 100000,
        availableCredit: 98701,
        cardLastFour: '1234',
        cardIssuer: 'Test Bank',
        cardHolder: null,
        statementPeriodStart: null,
        statementPeriodEnd: null,
        purchasesAndCharges: 1299,
        paymentsReceived: 0,
        interestCharged: null,
        lateFee: null,
        otherCharges: null,
        cashbackEarned: null,
        rewardPoints: null,
      } as Summary,
      warnings: [],
    });

    await finalizeReviewImport([reviewed], defaultDependencies);

    expect(defaultDependencies.addCreditCardStatement).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'cc-statement.pdf',
        totalDue: 1299,
        minimumDue: 130,
        cardLastFour: '1234',
      }),
    );
  });

  it('does not create CC statement for bank statements', async () => {
    const reviewed = makeTransaction({ id: 'txn-1', description: 'Salary', amount: 50000, type: 'credit' });

    reviewSessionRepository.save({
      transactions: [reviewed],
      currency: INR,
      format: 'csv',
      statementType: 'bank',
      fileName: 'bank.csv',
      parseDate: new Date(),
      statementSummary: {
        statementDate: null,
        statementPeriodStart: null,
        statementPeriodEnd: null,
        accountNumber: null,
        accountHolderName: null,
        bankName: null,
        accountType: null,
        openingBalance: 10000,
        closingBalance: 60000,
      } as Summary,
      warnings: [],
    });

    await finalizeReviewImport([reviewed], defaultDependencies);
    expect(defaultDependencies.addCreditCardStatement).not.toHaveBeenCalled();
  });

  it('clears review session after import', async () => {
    const reviewed = makeTransaction({ id: 'txn-1', description: 'Coffee Shop', amount: 250 });

    reviewSessionRepository.save({
      transactions: [reviewed],
      currency: INR,
      format: 'csv',
      statementType: 'bank',
      fileName: 'test.csv',
      parseDate: new Date(),
      statementSummary: null,
      warnings: [],
    });

    await finalizeReviewImport([reviewed], defaultDependencies);
    expect(reviewSessionRepository.load()).toBeNull();
  });

  it('returns result with correct structure', async () => {
    const reviewed = makeTransaction({ id: 'txn-1', description: 'Coffee Shop', amount: 250 });

    reviewSessionRepository.save({
      transactions: [reviewed],
      currency: INR,
      format: 'csv',
      statementType: 'bank',
      fileName: 'test.csv',
      parseDate: new Date(),
      statementSummary: null,
      warnings: [],
    });

    const result = await finalizeReviewImport([reviewed], defaultDependencies);

    expect(result).toHaveProperty('importedCount', 1);
    expect(result).toHaveProperty('learnedRuleUpdates');
    expect(result).toHaveProperty('postImportJobsTriggered');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('errors');
  });
});
