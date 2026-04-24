import { describe, it, expect } from 'vitest';
import { useTransactionStore } from '@/lib/store/transactionStore';
import { CategoryType } from '@/types';
import { makeTransaction as _makeTransaction, makeCategory } from '@tests/unit/factories';

// Local wrapper matching original positional signature
function makeTransaction(id: string = 'txn-1', amount: number = 1299, description: string = 'Test Transaction') {
  return _makeTransaction({ id, amount, description });
}

describe('useTransactionStore', () => {
  it('addTransactions adds transactions', () => {
    const ts = Date.now();
    const initialCount = useTransactionStore.getState().transactions.length;
    const txns = [
      makeTransaction(`new-1-${ts}`, 100, `Add test 1 ${ts}`),
      makeTransaction(`new-2-${ts}`, 200, `Add test 2 ${ts}`),
    ];
    useTransactionStore.getState().addTransactions(txns);
    const state = useTransactionStore.getState();
    expect(state.transactions.length).toBeGreaterThanOrEqual(initialCount + 2);
  });

  it('addTransactions deduplicates by signature', () => {
    const ts = Date.now();
    const txn = makeTransaction(`dedup-test-${ts}`, 300, `Dedup test ${ts}`);
    useTransactionStore.getState().addTransactions([txn]);
    const countBefore = useTransactionStore.getState().transactions.filter(t => t.description === `Dedup test ${ts}`).length;
    // Adding the same transaction again should not increase count
    useTransactionStore.getState().addTransactions([txn]);
    const countAfter = useTransactionStore.getState().transactions.filter(t => t.description === `Dedup test ${ts}`).length;
    expect(countAfter).toBe(countBefore);
  });

  it('getTransactionsByDateRange filters', () => {
    const ts = Date.now();
    const txn = _makeTransaction({ id: `date-filter-${ts}`, date: new Date('2024-06-15'), description: `Date filter ${ts}`, amount: 500, category: makeCategory('dining') });
    useTransactionStore.getState().addTransactions([txn]);
    const filtered = useTransactionStore.getState().getTransactionsByDateRange(
      new Date('2024-06-01'),
      new Date('2024-06-30'),
    );
    expect(filtered.some(t => t.id === `date-filter-${ts}`)).toBe(true);
  });

  it('getTotalIncome sums income', () => {
    const ts = Date.now();
    const txn = _makeTransaction({ id: `income-test-${ts}`, date: new Date('2024-01-15'), description: `Income test ${ts}`, amount: 50000, type: 'credit', category: makeCategory('income', CategoryType.Income) });
    useTransactionStore.getState().addTransactions([txn]);
    const total = useTransactionStore.getState().getTotalIncome();
    expect(total).toBeGreaterThanOrEqual(50000);
  });

  it('getTotalExpenses sums expenses', () => {
    const ts = Date.now();
    const txn = makeTransaction(`expense-test-${ts}`, 400, `Expense test ${ts}`);
    useTransactionStore.getState().addTransactions([txn]);
    const total = useTransactionStore.getState().getTotalExpenses();
    expect(total).toBeGreaterThanOrEqual(400);
  });

  it('dismissAnomaly sets flag', () => {
    const ts = Date.now();
    // Use a unique amount+description to avoid content-based dedup
    const uniqueId = `anomaly-test-${ts}`;
    const txn = makeTransaction(uniqueId, 777, `Anomaly test ${ts}`);
    useTransactionStore.getState().addTransactions([txn]);
    // Verify it was actually added
    const added = useTransactionStore.getState().transactions.find(t => t.id === uniqueId);
    expect(added).toBeDefined();
    useTransactionStore.getState().dismissAnomaly(uniqueId);
    const stateTxn = useTransactionStore.getState().transactions.find(t => t.id === uniqueId);
    expect(stateTxn?.anomalyDismissed).toBe(true);
  });
});
