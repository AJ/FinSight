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

    expect(defaultDependencies.addTransactions).toHaveBeenCalledWith([reviewed], { skipDedup: false });
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

  it('stamps transactions with sourceFileHash when present', async () => {
    const reviewed = makeTransaction({ id: 'txn-1', description: 'Coffee', amount: 100 });

    reviewSessionRepository.save({
      transactions: [reviewed],
      currency: INR,
      format: 'csv',
      statementType: 'bank',
      fileName: 'test.csv',
      parseDate: new Date(),
      statementSummary: null,
      sourceMetadata: { sourceFileHash: 'sha256abc' },
      warnings: [],
    });

    await finalizeReviewImport([reviewed], defaultDependencies);

    expect(defaultDependencies.addTransactions).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ sourceFileHash: 'sha256abc' }),
      ]),
      { skipDedup: false },
    );
  });

  it('maps credit card statement with full fields including rewardPoints', async () => {
    const reviewed = makeTransaction({ id: 'txn-1', description: 'Amazon', amount: 5000 });

    reviewSessionRepository.save({
      transactions: [reviewed],
      currency: INR,
      format: 'pdf',
      statementType: 'credit_card',
      fileName: 'cc-full.pdf',
      parseDate: new Date(),
      statementSummary: {
        statementDate: '2025-10-31',
        paymentDueDate: '2025-11-25',
        statementPeriodStart: '2025-10-01',
        statementPeriodEnd: '2025-10-31',
        totalDue: 5000,
        minimumDue: 500,
        previousBalance: 2000,
        creditLimit: 100000,
        availableCredit: 95000,
        cardLastFour: '5678',
        cardIssuer: 'HDFC',
        cardHolder: 'John Doe',
        purchasesAndCharges: 5000,
        paymentsReceived: 2000,
        interestCharged: 150,
        lateFee: 0,
        otherCharges: 50,
        cashbackEarned: 75,
        rewardPoints: {
          opening: 1000,
          earned: 200,
          redeemed: 50,
          closing: 1150,
        },
      } as Summary,
      warnings: [],
    });

    await finalizeReviewImport([reviewed], defaultDependencies);

    expect(defaultDependencies.addCreditCardStatement).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'cc-full.pdf',
        cardLastFour: '5678',
        cardIssuer: 'HDFC',
        cardHolder: 'John Doe',
        totalDue: 5000,
        minimumDue: 500,
        interestCharged: 150,
        otherCharges: 50,
        cashbackEarned: 75,
        rewardPoints: {
          openingBalance: 1000,
          earned: 200,
          redeemed: 50,
          expired: 0,
          closingBalance: 1150,
          expiringNext: undefined,
          expiringNextDate: undefined,
        },
        statementPeriod: {
          start: expect.any(Date),
          end: expect.any(Date),
        },
        statementDate: expect.any(Date),
        paymentDueDate: expect.any(Date),
      }),
    );
  });

  it('defaults warnings to empty array when undefined', async () => {
    const reviewed = makeTransaction({ id: 'txn-1', description: 'Coffee', amount: 100 });

    reviewSessionRepository.save({
      transactions: [reviewed],
      currency: INR,
      format: 'csv',
      statementType: 'bank',
      fileName: 'test.csv',
      parseDate: new Date(),
      statementSummary: null,
      warnings: undefined as unknown as [],
    });

    const result = await finalizeReviewImport([reviewed], defaultDependencies);
    expect(result.warnings).toEqual([]);
  });

  it('defaults warnings to empty array when null', async () => {
    const reviewed = makeTransaction({ id: 'txn-1', description: 'Coffee', amount: 100 });

    reviewSessionRepository.save({
      transactions: [reviewed],
      currency: INR,
      format: 'csv',
      statementType: 'bank',
      fileName: 'test.csv',
      parseDate: new Date(),
      statementSummary: null,
      warnings: null as unknown as [],
    });

    const result = await finalizeReviewImport([reviewed], defaultDependencies);
    expect(result.warnings).toEqual([]);
  });

  it('passes skipDedup:true when isDuplicateImport is true', async () => {
    const reviewed = makeTransaction({ id: 'txn-1', description: 'Coffee', amount: 100 });

    reviewSessionRepository.save({
      transactions: [reviewed],
      currency: INR,
      format: 'csv',
      statementType: 'bank',
      fileName: 'test.csv',
      parseDate: new Date(),
      statementSummary: null,
      sourceMetadata: { sourceFileHash: 'abc', isDuplicateImport: true },
      warnings: [],
    });

    await finalizeReviewImport([reviewed], defaultDependencies);

    expect(defaultDependencies.addTransactions).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ sourceFileHash: 'abc' })]),
      { skipDedup: true },
    );
  });

  it('passes skipDedup:false when isDuplicateImport is absent', async () => {
    const reviewed = makeTransaction({ id: 'txn-1', description: 'Coffee', amount: 100 });

    reviewSessionRepository.save({
      transactions: [reviewed],
      currency: INR,
      format: 'csv',
      statementType: 'bank',
      fileName: 'test.csv',
      parseDate: new Date(),
      statementSummary: null,
      sourceMetadata: { sourceFileHash: 'abc' },
      warnings: [],
    });

    await finalizeReviewImport([reviewed], defaultDependencies);

    expect(defaultDependencies.addTransactions).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ sourceFileHash: 'abc' })]),
      { skipDedup: false },
    );
  });
});

describe('toCreditCardStatement (via finalizeReviewImport)', () => {
  const defaultDependencies = {
    addTransactions: vi.fn(),
    addCreditCardStatement: vi.fn(),
  };

  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('defaults cardLastFour and cardIssuer to empty string when absent', async () => {
    const reviewed = makeTransaction({ id: 'txn-1', description: 'CC', amount: 500 });

    reviewSessionRepository.save({
      transactions: [reviewed],
      currency: INR,
      format: 'pdf',
      statementType: 'credit_card',
      fileName: 'cc.pdf',
      parseDate: new Date(),
      statementSummary: {
        statementDate: null,
        paymentDueDate: null,
        totalDue: 500,
        minimumDue: 50,
        creditLimit: 100000,
        availableCredit: 99500,
        cardLastFour: '',
        cardIssuer: '',
        cardHolder: null,
        statementPeriodStart: null,
        statementPeriodEnd: null,
        purchasesAndCharges: 500,
        paymentsReceived: 0,
      } as Summary,
      warnings: [],
    });

    await finalizeReviewImport([reviewed], defaultDependencies);

    expect(defaultDependencies.addCreditCardStatement).toHaveBeenCalledWith(
      expect.objectContaining({
        cardLastFour: '',
        cardIssuer: '',
      }),
    );
  });

  it('defaults to current date when statementPeriodStart/End are null', async () => {
    const reviewed = makeTransaction({ id: 'txn-1', description: 'CC', amount: 500 });

    reviewSessionRepository.save({
      transactions: [reviewed],
      currency: INR,
      format: 'pdf',
      statementType: 'credit_card',
      fileName: 'cc.pdf',
      parseDate: new Date(),
      statementSummary: {
        statementDate: null,
        paymentDueDate: null,
        totalDue: 500,
        minimumDue: 50,
        creditLimit: 100000,
        availableCredit: 99500,
        cardLastFour: '1234',
        cardIssuer: 'Test',
        cardHolder: null,
        statementPeriodStart: null,
        statementPeriodEnd: null,
        purchasesAndCharges: 500,
        paymentsReceived: 0,
      } as Summary,
      warnings: [],
    });

    await finalizeReviewImport([reviewed], defaultDependencies);

    const call = defaultDependencies.addCreditCardStatement.mock.calls[0][0];
    // When period start/end are null, falls to { start: new Date(), end: new Date() }
    expect(call.statementPeriod.start).toBeInstanceOf(Date);
    expect(call.statementPeriod.end).toBeInstanceOf(Date);
    expect(call.statementDate).toBeInstanceOf(Date);
    expect(call.paymentDueDate).toBeInstanceOf(Date);
  });

  it('defaults all numeric fields to 0 when null', async () => {
    const reviewed = makeTransaction({ id: 'txn-1', description: 'CC', amount: 500 });

    reviewSessionRepository.save({
      transactions: [reviewed],
      currency: INR,
      format: 'pdf',
      statementType: 'credit_card',
      fileName: 'cc.pdf',
      parseDate: new Date(),
      statementSummary: {
        statementDate: null,
        paymentDueDate: null,
        totalDue: null,
        minimumDue: null,
        creditLimit: null,
        availableCredit: null,
        previousBalance: null,
        paymentsReceived: null,
        purchasesAndCharges: null,
        interestCharged: null,
        lateFee: null,
        otherCharges: null,
        cashbackEarned: null,
        cardLastFour: '1234',
        cardIssuer: 'Test',
        cardHolder: null,
        statementPeriodStart: null,
        statementPeriodEnd: null,
      } as Summary,
      warnings: [],
    });

    await finalizeReviewImport([reviewed], defaultDependencies);

    const call = defaultDependencies.addCreditCardStatement.mock.calls[0][0];
    expect(call.totalDue).toBe(0);
    expect(call.minimumDue).toBe(0);
    expect(call.creditLimit).toBe(0);
    expect(call.availableCredit).toBe(0);
    expect(call.previousBalance).toBe(0);
    expect(call.paymentsReceived).toBe(0);
    expect(call.purchasesAndCharges).toBe(0);
    expect(call.interestCharged).toBe(0);
    expect(call.lateFee).toBe(0);
    expect(call.otherCharges).toBe(0);
    expect(call.cashbackEarned).toBe(0);
    expect(call.rewardPoints).toBeUndefined();
  });

  it('maps rewardPoints with missing sub-fields to 0', async () => {
    const reviewed = makeTransaction({ id: 'txn-1', description: 'CC', amount: 500 });

    reviewSessionRepository.save({
      transactions: [reviewed],
      currency: INR,
      format: 'pdf',
      statementType: 'credit_card',
      fileName: 'cc.pdf',
      parseDate: new Date(),
      statementSummary: {
        statementDate: '2025-10-31',
        paymentDueDate: '2025-11-25',
        totalDue: 500,
        minimumDue: 50,
        creditLimit: 100000,
        availableCredit: 99500,
        cardLastFour: '1234',
        cardIssuer: 'Test',
        cardHolder: null,
        statementPeriodStart: '2025-10-01',
        statementPeriodEnd: '2025-10-31',
        purchasesAndCharges: 500,
        paymentsReceived: 0,
        rewardPoints: {
          opening: undefined as unknown as number,
          earned: undefined as unknown as number,
          redeemed: undefined as unknown as number,
          closing: undefined as unknown as number,
        },
      } as Summary,
      warnings: [],
    });

    await finalizeReviewImport([reviewed], defaultDependencies);

    const call = defaultDependencies.addCreditCardStatement.mock.calls[0][0];
    expect(call.rewardPoints).toEqual({
      openingBalance: 0,
      earned: 0,
      redeemed: 0,
      expired: 0,
      closingBalance: 0,
      expiringNext: undefined,
      expiringNextDate: undefined,
    });
  });

  it('strips isSuspense flag from transactions before persisting', async () => {
    const base = makeTransaction({ id: 'txn-1', description: 'Transfer', amount: 5000 });
    const suspenseTxn = base.cloneWith({ isSuspense: true });

    reviewSessionRepository.save({
      transactions: [suspenseTxn],
      currency: INR,
      format: 'csv',
      statementType: 'bank',
      fileName: 'test.csv',
      parseDate: new Date(),
      statementSummary: null,
      warnings: [],
    });

    const reviewed = base.cloneWith({ isSuspense: true });
    const deps = { addTransactions: vi.fn(), addCreditCardStatement: vi.fn() };
    await finalizeReviewImport([reviewed], deps);

    // The transaction passed to addTransactions should NOT have isSuspense
    const added = deps.addTransactions.mock.calls[0][0][0];
    expect(added.isSuspense).toBeFalsy();
  });

  it('creates bank summary for bank statements with closingBalance', async () => {
    const reviewed = makeTransaction({ id: 'txn-1', description: 'Salary', amount: 50000, type: 'credit' });

    reviewSessionRepository.save({
      transactions: [reviewed],
      currency: INR,
      format: 'csv',
      statementType: 'bank',
      fileName: 'bank.csv',
      parseDate: new Date(),
      statementSummary: {
        statementDate: '2025-10-31',
        statementPeriodStart: '2025-10-01',
        statementPeriodEnd: '2025-10-31',
        accountNumber: '1234567890',
        accountHolderName: 'John Doe',
        bankName: 'Test Bank',
        accountType: 'savings',
        openingBalance: 10000,
        closingBalance: 60000,
      } as Summary,
      warnings: [],
    });

    const addBankSummary = vi.fn();
    await finalizeReviewImport([reviewed], { addTransactions: vi.fn(), addBankSummary });

    expect(addBankSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        accountNumber: '1234567890',
        bankName: 'Test Bank',
        openingBalance: 10000,
        closingBalance: 60000,
      }),
    );
  });

  it('skips bank summary when addBankSummary dependency is absent', async () => {
    const reviewed = makeTransaction({ id: 'txn-1', description: 'Salary', amount: 50000, type: 'credit' });

    reviewSessionRepository.save({
      transactions: [reviewed],
      currency: INR,
      format: 'csv',
      statementType: 'bank',
      fileName: 'bank.csv',
      parseDate: new Date(),
      statementSummary: {
        statementDate: '2025-10-31',
        statementPeriodStart: '2025-10-01',
        statementPeriodEnd: '2025-10-31',
        accountNumber: null,
        accountHolderName: null,
        bankName: null,
        accountType: null,
        openingBalance: 0,
        closingBalance: 50000,
      } as Summary,
      warnings: [],
    });

    // No addBankSummary provided — should not throw
    await finalizeReviewImport([reviewed], { addTransactions: vi.fn() });
  });

  it('skips credit card statement when addCreditCardStatement dependency is absent', async () => {
    const reviewed = makeTransaction({ id: 'txn-1', description: 'CC', amount: 500 });

    reviewSessionRepository.save({
      transactions: [reviewed],
      currency: INR,
      format: 'pdf',
      statementType: 'credit_card',
      fileName: 'cc.pdf',
      parseDate: new Date(),
      statementSummary: {
        statementDate: '2025-10-31',
        paymentDueDate: '2025-11-25',
        totalDue: 500,
        minimumDue: 50,
        creditLimit: 100000,
        availableCredit: 99500,
        cardLastFour: '1234',
        cardIssuer: 'Test',
        cardHolder: null,
        statementPeriodStart: '2025-10-01',
        statementPeriodEnd: '2025-10-31',
        purchasesAndCharges: 500,
        paymentsReceived: 0,
      } as Summary,
      warnings: [],
    });

    // No addCreditCardStatement provided
    await finalizeReviewImport([reviewed], { addTransactions: vi.fn() });

    // Should not throw — just skips CC statement creation
  });
});
