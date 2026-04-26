import { describe, it, expect, beforeEach } from 'vitest';
import { useTransactionStore } from '@/lib/store/transactionStore';
import { CategoryType } from '@/types';
import { makeTransaction as _makeTransaction, makeCategory } from '@tests/unit/factories';

// Local wrapper matching original positional signature
function makeTransaction(id: string = 'txn-1', amount: number = 1299, description: string = 'Test Transaction') {
  return _makeTransaction({ id, amount, description });
}

describe('useTransactionStore', () => {
  beforeEach(() => {
    useTransactionStore.getState().clearAll();
  });

  it('addTransactions adds transactions', () => {
    const txns = [
      makeTransaction('txn-a', 100, 'Add test 1'),
      makeTransaction('txn-b', 200, 'Add test 2'),
    ];
    useTransactionStore.getState().addTransactions(txns);
    expect(useTransactionStore.getState().transactions).toHaveLength(2);
  });

  it('addTransactions deduplicates by signature', () => {
    const txn = makeTransaction('dedup-1', 300, 'Dedup test');
    useTransactionStore.getState().addTransactions([txn]);
    useTransactionStore.getState().addTransactions([txn]);
    expect(useTransactionStore.getState().transactions.filter(t => t.description === 'Dedup test')).toHaveLength(1);
  });

  it('getTransactionsByDateRange filters', () => {
    const txn = _makeTransaction({ id: 'date-1', date: new Date('2024-06-15'), description: 'Date filter', amount: 500, category: makeCategory('dining') });
    useTransactionStore.getState().addTransactions([txn]);
    const filtered = useTransactionStore.getState().getTransactionsByDateRange(
      new Date('2024-06-01'),
      new Date('2024-06-30'),
    );
    expect(filtered.some(t => t.id === 'date-1')).toBe(true);
  });

  it('getTotalIncome sums income', () => {
    const txn = _makeTransaction({ id: 'inc-1', date: new Date('2024-01-15'), description: 'Income test', amount: 50000, type: 'credit', category: makeCategory('income', CategoryType.Income) });
    useTransactionStore.getState().addTransactions([txn]);
    expect(useTransactionStore.getState().getTotalIncome()).toBe(50000);
  });

  it('getTotalExpenses sums expenses', () => {
    const txn = makeTransaction('exp-1', 400, 'Expense test');
    useTransactionStore.getState().addTransactions([txn]);
    expect(useTransactionStore.getState().getTotalExpenses()).toBe(400);
  });

  it('dismissAnomaly sets flag', () => {
    const txn = makeTransaction('anom-1', 777, 'Anomaly test');
    useTransactionStore.getState().addTransactions([txn]);
    useTransactionStore.getState().dismissAnomaly('anom-1');
    expect(useTransactionStore.getState().transactions.find(t => t.id === 'anom-1')?.anomalyDismissed).toBe(true);
  });
});
