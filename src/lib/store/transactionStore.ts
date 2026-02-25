import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Transaction } from '@/types';
import { useSettingsStore } from './settingsStore';

// Lazy import to avoid circular dependencies
let categorizationPromise: Promise<typeof import('@/lib/categorization/aiCategorizer')> | null = null;

/**
 * Ensure a value is a proper Date object.
 * Zustand persist serializes Date → string; this converts it back.
 */
function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

/** Rehydrate all date fields in a transaction array */
function rehydrateDates(txns: Transaction[]): Transaction[] {
  return txns.map((t) => ({ ...t, date: toDate(t.date) }));
}

interface TransactionStore {
  transactions: Transaction[];
  selectedIds: string[];
  isCategorizing: boolean;
  categorizeProgress: string;
  addTransactions: (txns: Transaction[]) => void;
  updateTransaction: (id: string, updates: Partial<Transaction>) => void;
  deleteTransaction: (id: string) => void;
  clearAll: () => void;
  getTransactionsByDateRange: (startDate: Date, endDate: Date) => Transaction[];
  getTransactionsByCategory: (category: string) => Transaction[];
  getTotalIncome: (startDate?: Date, endDate?: Date) => number;
  getTotalExpenses: (startDate?: Date, endDate?: Date) => number;
  // Selection actions
  toggleSelection: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setSelectedIds: (ids: string[]) => void;
  // Category actions
  updateCategory: (id: string, categoryId: string, categorizedBy?: 'keyword' | 'ai' | 'manual') => void;
  getTransactionsNeedingReview: () => Transaction[];
  // Background categorization
  startBackgroundCategorization: () => void;
}

export const useTransactionStore = create<TransactionStore>()(
  persist(
    (set, get) => ({
      transactions: [],
      selectedIds: [],
      isCategorizing: false,
      categorizeProgress: '',

      addTransactions: (txns) =>
        set((state) => ({
          transactions: [...state.transactions, ...rehydrateDates(txns)],
        })),

      updateTransaction: (id, updates) =>
        set((state) => ({
          transactions: state.transactions.map((txn) =>
            txn.id === id ? { ...txn, ...updates } : txn
          ),
        })),

      deleteTransaction: (id) =>
        set((state) => ({
          transactions: state.transactions.filter((txn) => txn.id !== id),
        })),

      clearAll: () => set({ transactions: [], selectedIds: [] }),

      getTransactionsByDateRange: (startDate, endDate) => {
        return get().transactions.filter((txn) => {
          const d = toDate(txn.date);
          return d >= startDate && d <= endDate;
        });
      },

      getTransactionsByCategory: (category) => {
        return get().transactions.filter((txn) => txn.category === category);
      },

      getTotalIncome: (startDate, endDate) => {
        let txns = get().transactions.filter((txn) => txn.type === 'income');
        if (startDate && endDate) {
          txns = txns.filter((txn) => {
            const d = toDate(txn.date);
            return d >= startDate && d <= endDate;
          });
        }
        return txns.reduce((sum, txn) => sum + txn.amount, 0);
      },

      getTotalExpenses: (startDate, endDate) => {
        let txns = get().transactions.filter((txn) => txn.type === 'expense');
        if (startDate && endDate) {
          txns = txns.filter((txn) => {
            const d = toDate(txn.date);
            return d >= startDate && d <= endDate;
          });
        }
        return txns.reduce((sum, txn) => sum + Math.abs(txn.amount), 0);
      },

      // Selection actions
      toggleSelection: (id) =>
        set((state) => ({
          selectedIds: state.selectedIds.includes(id)
            ? state.selectedIds.filter((sid) => sid !== id)
            : [...state.selectedIds, id],
        })),

      selectAll: () =>
        set((state) => ({
          selectedIds: state.transactions.map((txn) => txn.id),
        })),

      clearSelection: () => set({ selectedIds: [] }),

      setSelectedIds: (ids) => set({ selectedIds: ids }),

      // Category actions
      updateCategory: (id, categoryId, categorizedBy = 'manual') =>
        set((state) => ({
          transactions: state.transactions.map((txn) =>
            txn.id === id
              ? {
                  ...txn,
                  category: categoryId,
                  categorizedBy,
                  needsReview: false, // Clear review flag on manual change
                }
              : txn
          ),
        })),

      getTransactionsNeedingReview: () => {
        return get().transactions.filter((txn) => txn.needsReview === true);
      },

      // Background categorization
      startBackgroundCategorization: () => {
        const { transactions, isCategorizing } = get();
        if (isCategorizing || transactions.length === 0) return;

        // Delay start by 5 seconds to let user see import complete first
        setTimeout(async () => {
          set({ isCategorizing: true, categorizeProgress: 'Starting categorization...' });

          try {
            // Get settings
            const settings = useSettingsStore.getState();
            const { llmProvider, ollamaUrl, llmModel } = settings;

            // Lazy load categorizer to avoid circular deps
            if (!categorizationPromise) {
              categorizationPromise = import('@/lib/categorization/aiCategorizer');
            }
            const { categorizeTransactions, applyCategorizationResults } = await categorizationPromise;

            // Run categorization
            const results = await categorizeTransactions(
              get().transactions,
              {
                provider: llmProvider,
                baseUrl: ollamaUrl,
                model: llmModel || '',
                onProgress: (progress) => {
                  set({
                    categorizeProgress: `Categorizing... ${progress.processed}/${progress.total}`
                  });
                },
              }
            );

            // Apply results
            const categorized = applyCategorizationResults(get().transactions, results);
            set({
              transactions: categorized,
              isCategorizing: false,
              categorizeProgress: `Completed: ${results.length} transactions categorized`
            });

            // Clear progress after 3 seconds
            setTimeout(() => set({ categorizeProgress: '' }), 3000);
          } catch (error) {
            console.error('[BackgroundCategorization]', error);
            set({
              isCategorizing: false,
              categorizeProgress: 'Categorization failed'
            });
            setTimeout(() => set({ categorizeProgress: '' }), 5000);
          }
        }, 5000);
      },
    }),
    {
      name: 'transaction-storage',
      // Rehydrate dates from JSON strings back to Date objects on load
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.transactions = rehydrateDates(state.transactions);
        }
      },
    }
  )
);
