import { describe, it, expect, beforeEach } from 'vitest';
import { useTransactionStore } from '@/lib/store/transactionStore';
import { CategoryType, SourceType, type Transaction } from '@/types';
import { makeTransaction as _makeTransaction, makeCategory } from '@tests/unit/factories';

function makeTransaction(id: string = 'txn-1', amount: number = 1299, description: string = 'Test Transaction') {
  return _makeTransaction({ id, amount, description });
}

describe('useTransactionStore', () => {
  beforeEach(() => {
    useTransactionStore.getState().clearAll();
  });

  describe('addTransactions', () => {
    it('adds transactions', () => {
      const txns = [
        makeTransaction('txn-a', 100, 'Add test 1'),
        makeTransaction('txn-b', 200, 'Add test 2'),
      ];
      useTransactionStore.getState().addTransactions(txns);
      expect(useTransactionStore.getState().transactions).toHaveLength(2);
    });

    it('deduplicates by signature', () => {
      const txn = makeTransaction('dedup-1', 300, 'Dedup test');
      useTransactionStore.getState().addTransactions([txn]);
      useTransactionStore.getState().addTransactions([txn]);
      expect(useTransactionStore.getState().transactions.filter(t => t.description === 'Dedup test')).toHaveLength(1);
    });
  });

  describe('updateTransaction', () => {
    it('updates description on matching transaction', () => {
      useTransactionStore.getState().addTransactions([makeTransaction('upd-1')]);
      useTransactionStore.getState().updateTransaction('upd-1', { description: 'Updated' });
      expect(useTransactionStore.getState().transactions[0].description).toBe('Updated');
    });

    it('resolves category from string ID', () => {
      useTransactionStore.getState().addTransactions([makeTransaction('upd-2')]);
      // Production code resolves string category IDs via typeof check at runtime
      useTransactionStore.getState().updateTransaction('upd-2', { category: 'dining' } as unknown as Partial<Transaction>);
      expect(useTransactionStore.getState().transactions[0].category.id).toBe('dining');
    });

    it('resolves category from Category instance', () => {
      useTransactionStore.getState().addTransactions([makeTransaction('upd-3')]);
      useTransactionStore.getState().updateTransaction('upd-3', { category: makeCategory('groceries') });
      expect(useTransactionStore.getState().transactions[0].category.id).toBe('groceries');
    });

    it('preserves fields not in updates', () => {
      useTransactionStore.getState().addTransactions([makeTransaction('upd-4', 500, 'Original')]);
      useTransactionStore.getState().updateTransaction('upd-4', { description: 'Changed' });
      const txn = useTransactionStore.getState().transactions[0];
      expect(txn.amount).toBe(500);
      expect(txn.description).toBe('Changed');
    });

    it('leaves non-matching transactions unchanged', () => {
      useTransactionStore.getState().addTransactions([
        makeTransaction('upd-5', 100, 'Keep'),
        makeTransaction('upd-6', 200, 'Change'),
      ]);
      useTransactionStore.getState().updateTransaction('upd-6', { amount: 999 });
      expect(useTransactionStore.getState().transactions[0].amount).toBe(100);
    });
  });

  describe('deleteTransaction', () => {
    it('removes matching transaction', () => {
      useTransactionStore.getState().addTransactions([
        makeTransaction('del-1'),
        makeTransaction('del-2'),
      ]);
      useTransactionStore.getState().deleteTransaction('del-1');
      expect(useTransactionStore.getState().transactions).toHaveLength(1);
      expect(useTransactionStore.getState().transactions[0].id).toBe('del-2');
    });

    it('is a no-op for nonexistent id', () => {
      useTransactionStore.getState().addTransactions([makeTransaction('del-3')]);
      useTransactionStore.getState().deleteTransaction('nonexistent');
      expect(useTransactionStore.getState().transactions).toHaveLength(1);
    });
  });

  describe('clearAll', () => {
    it('removes all transactions and selection', () => {
      useTransactionStore.getState().addTransactions([makeTransaction('c-1')]);
      useTransactionStore.getState().setSelectedIds(['c-1']);
      useTransactionStore.getState().clearAll();
      expect(useTransactionStore.getState().transactions).toHaveLength(0);
      expect(useTransactionStore.getState().selectedIds).toHaveLength(0);
    });
  });

  describe('getTransactionsByDateRange', () => {
    it('filters within range', () => {
      const txn = _makeTransaction({ id: 'date-1', date: new Date('2024-06-15'), description: 'Date filter', amount: 500, category: makeCategory('dining') });
      useTransactionStore.getState().addTransactions([txn]);
      const filtered = useTransactionStore.getState().getTransactionsByDateRange(
        new Date('2024-06-01'),
        new Date('2024-06-30'),
      );
      expect(filtered.some(t => t.id === 'date-1')).toBe(true);
    });
  });

  describe('getTransactionsByCategory', () => {
    it('returns transactions matching category id', () => {
      useTransactionStore.getState().addTransactions([
        _makeTransaction({ id: 'cat-1', category: makeCategory('dining') }),
        _makeTransaction({ id: 'cat-2', category: makeCategory('groceries') }),
      ]);
      const result = useTransactionStore.getState().getTransactionsByCategory('dining');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('cat-1');
    });

    it('returns empty for no match', () => {
      useTransactionStore.getState().addTransactions([_makeTransaction({ id: 'cat-3', category: makeCategory('dining') })]);
      expect(useTransactionStore.getState().getTransactionsByCategory('travel')).toHaveLength(0);
    });
  });

  describe('getTotalIncome', () => {
    it('sums income without date range', () => {
      const txn = _makeTransaction({ id: 'inc-1', date: new Date('2024-01-15'), description: 'Income test', amount: 50000, type: 'credit', category: makeCategory('income', CategoryType.Income) });
      useTransactionStore.getState().addTransactions([txn]);
      expect(useTransactionStore.getState().getTotalIncome()).toBe(50000);
    });

    it('filters by date range', () => {
      useTransactionStore.getState().addTransactions([
        _makeTransaction({ id: 'inc-2', date: new Date('2024-01-15'), amount: 10000, type: 'credit', category: makeCategory('income', CategoryType.Income) }),
        _makeTransaction({ id: 'inc-3', date: new Date('2024-06-15'), amount: 20000, type: 'credit', category: makeCategory('income', CategoryType.Income) }),
      ]);
      const total = useTransactionStore.getState().getTotalIncome(
        new Date('2024-06-01'),
        new Date('2024-06-30'),
      );
      expect(total).toBe(20000);
    });
  });

  describe('getTotalExpenses', () => {
    it('sums expenses without date range', () => {
      const txn = makeTransaction('exp-1', 400, 'Expense test');
      useTransactionStore.getState().addTransactions([txn]);
      expect(useTransactionStore.getState().getTotalExpenses()).toBe(400);
    });

    it('filters by date range', () => {
      useTransactionStore.getState().addTransactions([
        _makeTransaction({ id: 'exp-2', date: new Date('2024-01-15'), amount: 5000 }),
        _makeTransaction({ id: 'exp-3', date: new Date('2024-06-15'), amount: 3000 }),
      ]);
      const total = useTransactionStore.getState().getTotalExpenses(
        new Date('2024-06-01'),
        new Date('2024-06-30'),
      );
      expect(total).toBe(3000);
    });
  });

  describe('selection actions', () => {
    it('toggleSelection adds id when not selected', () => {
      useTransactionStore.getState().addTransactions([makeTransaction('sel-1')]);
      useTransactionStore.getState().toggleSelection('sel-1');
      expect(useTransactionStore.getState().selectedIds).toContain('sel-1');
    });

    it('toggleSelection removes id when already selected', () => {
      useTransactionStore.getState().addTransactions([makeTransaction('sel-2')]);
      useTransactionStore.getState().toggleSelection('sel-2');
      useTransactionStore.getState().toggleSelection('sel-2');
      expect(useTransactionStore.getState().selectedIds).not.toContain('sel-2');
    });

    it('selectAll selects all transaction ids', () => {
      useTransactionStore.getState().addTransactions([
        makeTransaction('sel-3'),
        makeTransaction('sel-4'),
      ]);
      useTransactionStore.getState().selectAll();
      expect(useTransactionStore.getState().selectedIds).toEqual(['sel-3', 'sel-4']);
    });

    it('clearSelection empties selectedIds', () => {
      useTransactionStore.getState().setSelectedIds(['a', 'b']);
      useTransactionStore.getState().clearSelection();
      expect(useTransactionStore.getState().selectedIds).toHaveLength(0);
    });

    it('setSelectedIds replaces selection', () => {
      useTransactionStore.getState().setSelectedIds(['x', 'y']);
      expect(useTransactionStore.getState().selectedIds).toEqual(['x', 'y']);
    });
  });

  describe('updateCategory', () => {
    it('updates category on matching transaction', () => {
      useTransactionStore.getState().addTransactions([makeTransaction('uc-1')]);
      useTransactionStore.getState().updateCategory('uc-1', 'dining');
      expect(useTransactionStore.getState().transactions[0].category.id).toBe('dining');
    });

    it('is a no-op for nonexistent id', () => {
      useTransactionStore.getState().addTransactions([makeTransaction('uc-2')]);
      useTransactionStore.getState().updateCategory('nonexistent', 'dining');
      expect(useTransactionStore.getState().transactions[0].category.id).toBe('shopping');
    });
  });

  describe('getTransactionsNeedingReview', () => {
    it('returns transactions with needsReview=true', () => {
      useTransactionStore.getState().addTransactions([
        _makeTransaction({ id: 'rev-1', needsReview: true }),
        _makeTransaction({ id: 'rev-2', needsReview: false }),
      ]);
      const result = useTransactionStore.getState().getTransactionsNeedingReview();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('rev-1');
    });
  });

  describe('anomaly actions', () => {
    it('dismissAnomaly sets flag', () => {
      useTransactionStore.getState().addTransactions([makeTransaction('anom-1')]);
      useTransactionStore.getState().dismissAnomaly('anom-1');
      expect(useTransactionStore.getState().transactions.find(t => t.id === 'anom-1')?.anomalyDismissed).toBe(true);
    });

    it('restoreAnomaly clears flag', () => {
      useTransactionStore.getState().addTransactions([makeTransaction('anom-2')]);
      useTransactionStore.getState().dismissAnomaly('anom-2');
      useTransactionStore.getState().restoreAnomaly('anom-2');
      expect(useTransactionStore.getState().transactions.find(t => t.id === 'anom-2')?.anomalyDismissed).toBe(false);
    });

    it('getActiveAnomalies returns anomalous non-dismissed transactions', () => {
      useTransactionStore.getState().addTransactions([
        _makeTransaction({ id: 'act-1', isAnomaly: true, anomalyDismissed: false }),
        _makeTransaction({ id: 'act-2', isAnomaly: true, anomalyDismissed: true }),
        _makeTransaction({ id: 'act-3', isAnomaly: false }),
      ]);
      const result = useTransactionStore.getState().getActiveAnomalies();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('act-1');
    });
  });

  describe('hasFileImported', () => {
    it('returns alreadyImported false when no match', () => {
      const result = useTransactionStore.getState().hasFileImported('hash123');
      expect(result.alreadyImported).toBe(false);
    });

    it('returns import metadata when hash matches', () => {
      const txn = _makeTransaction({
        id: 'hash-1',
        date: new Date('2024-03-15'),
        sourceType: SourceType.Bank,
        sourceFileHash: 'abc123',
      });
      useTransactionStore.getState().addTransactions([txn]);

      const result = useTransactionStore.getState().hasFileImported('abc123');
      expect(result.alreadyImported).toBe(true);
      expect(result.sourceType).toBe(SourceType.Bank);
    });
  });
});
