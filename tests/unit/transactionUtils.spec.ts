import { describe, it, expect } from 'vitest';

import { getTransactionSignature, deduplicateTransactions } from '@/lib/transactionUtils';
import { TransactionType } from '@/types';
import { makeTransaction } from '@tests/unit/factories';
import '@/lib/categorization/categories';

describe('getTransactionSignature', () => {
  it('includes date, type, amount, and lowercase description', () => {
    const sig = getTransactionSignature({
      date: '2024-01-15',
      amount: 99.99,
      description: 'Amazon Purchase',
      type: TransactionType.Debit,
    });
    expect(sig).toBe('2024-01-15|debit|99.99|amazon purchase');
  });

  it('distinguishes a credit from a debit with the same date, amount, and description', () => {
    const credit = getTransactionSignature({ date: '2024-01-15', amount: 5000, description: 'Salary', type: TransactionType.Credit });
    const debit = getTransactionSignature({ date: '2024-01-15', amount: 5000, description: 'Salary', type: TransactionType.Debit });
    // A credit and a debit are different transactions; their signatures must differ so
    // dedup does not silently drop one of them.
    expect(credit).not.toBe(debit);
  });

  it('truncates description to 100 characters', () => {
    const longDesc = 'A'.repeat(200);
    const sig = getTransactionSignature({ date: '2024-01-15', amount: 100, description: longDesc, type: TransactionType.Debit });
    const descPart = sig.split('|')[3];
    expect(descPart.length).toBe(100);
  });

  it('produces same signature for identical transactions', () => {
    const sig1 = getTransactionSignature({ date: '2024-01-15', amount: 100, description: 'Test', type: TransactionType.Debit });
    const sig2 = getTransactionSignature({ date: '2024-01-15', amount: 100, description: 'Test', type: TransactionType.Debit });
    expect(sig1).toBe(sig2);
  });
});

describe('deduplicateTransactions', () => {
  it('removes exact duplicates', () => {
    const existing = [makeTransaction({ date: '2024-01-15', amount: 100, description: 'Amazon' })];
    const incoming = [makeTransaction({ date: '2024-01-15', amount: 100, description: 'Amazon' })];
    const result = deduplicateTransactions(incoming, existing);
    expect(result).toHaveLength(0);
  });

  it('preserves unique transactions', () => {
    const existing = [makeTransaction({ id: 'e1', date: '2024-01-15', amount: 100, description: 'Amazon' })];
    const incoming = [makeTransaction({ id: 'n1', date: '2024-01-16', amount: 200, description: 'Flipkart' })];
    const result = deduplicateTransactions(incoming, existing);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('n1');
  });

  it('handles empty existing list', () => {
    const incoming = [makeTransaction({ date: '2024-01-15', amount: 100, description: 'Amazon' })];
    const result = deduplicateTransactions(incoming, []);
    expect(result).toHaveLength(1);
  });

  it('handles empty new list', () => {
    const existing = [makeTransaction({ date: '2024-01-15', amount: 100, description: 'Amazon' })];
    const result = deduplicateTransactions([], existing);
    expect(result).toHaveLength(0);
  });

  it('handles both lists empty', () => {
    expect(deduplicateTransactions([], [])).toHaveLength(0);
  });
});
