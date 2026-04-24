import { describe, it, expect } from 'vitest';
import {
  toCategorizationInput,
  toTransactionType,
} from '@/lib/categorization/types';
import { TransactionType } from '@/models';
import { Transaction, Category, CategoryType, SourceType } from '@/types';

function makeCategory(id: string): Category {
  return new Category(id, id, CategoryType.Expense);
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return new Transaction(
    overrides.id || 'txn-1',
    overrides.date || new Date('2024-01-15'),
    overrides.description || 'Test Transaction',
    overrides.amount ?? 100,
    overrides.type ?? TransactionType.Debit,
    overrides.category ?? makeCategory('shopping'),
    undefined,  // balance
    undefined,  // merchant
    undefined,  // originalText
    undefined,  // budgetMonth
    undefined,  // categoryConfidence
    undefined,  // needsReview
    undefined,  // categorizedBy
    overrides.sourceType,  // sourceType (position 14)
    undefined,  // statementId
    undefined,  // cardIssuer
    undefined,  // cardLastFour
    undefined,  // cardHolder
    undefined,  // localCurrency
    undefined,  // originalCurrency
    undefined,  // originalAmount
    undefined,  // isInternational
    undefined,  // isAnomaly
    undefined,  // anomalyTypes
    undefined,  // anomalyDetails
    undefined,  // anomalyDismissed
    overrides.transactionSubType,  // transactionSubType (position 27)
  );
}

describe('toCategorizationInput', () => {
  it('converts full Transaction to categorization input', () => {
    const txn = makeTransaction({
      id: '1',
      description: 'AMAZON PURCHASE',
      amount: 1299,
      type: TransactionType.Debit,
      sourceType: SourceType.Bank,
      transactionSubType: 'purchase',
    });
    const result = toCategorizationInput(txn);
    expect(result.id).toBe('1');
    expect(result.description).toBe('AMAZON PURCHASE');
    expect(result.amount).toBe(1299);
    expect(result.type).toBe('debit');
    expect(result.sourceType).toBe(SourceType.Bank);
    expect(result.transactionSubType).toBe('purchase');
  });
});

describe('toTransactionType', () => {
  it('maps credit to TransactionType.Credit', () => {
    expect(toTransactionType('credit')).toBe(TransactionType.Credit);
  });

  it('maps debit to TransactionType.Debit', () => {
    expect(toTransactionType('debit')).toBe(TransactionType.Debit);
  });
});
