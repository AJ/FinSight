import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Transaction, Category, TransactionJSON, CategorizedBy } from '@/types';
import { useSettingsStore } from './settingsStore';
import '@/lib/categorization/categories'; // Ensure categories are registered before store hydrates

// Lazy import to avoid circular dependencies
let categorizationPromise: Promise<typeof import('@/lib/categorization/aiCategorizer')> | null = null;

/**
 * Ensure a value is a proper Date object.
 * Zustand persist serializes Date → string; this converts it back.
 */
function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

/** Rehydrate transactions from JSON to Transaction class instances */
function rehydrateTransactions(txns: Transaction[]): Transaction[] {
  return txns.map((t) => {
    // If already a Transaction instance with isIncome getter, return as-is
    if (t instanceof Transaction) {
      return new Transaction(
        t.id,
        toDate(t.date),
        t.description,
        t.amount,
        t.type,
        t.category instanceof Category ? t.category : Category.fromId(typeof t.category === 'string' ? t.category : Category.DEFAULT_ID) ?? Category.fromId(Category.DEFAULT_ID)!,
        t.balance,
        t.merchant,
        t.originalText,
        t.budgetMonth,
        t.categoryConfidence,
        t.needsReview,
        t.categorizedBy,
        t.sourceType,
        t.statementId,
        t.cardIssuer,
        t.cardLastFour,
        t.cardHolder,
        t.currency,
        t.originalAmount,
        t.isAnomaly,
        t.anomalyTypes,
        t.anomalyDetails,
        t.anomalyDismissed,
      );
    }
    // Otherwise reconstruct from JSON-like object
    const json = t as unknown as TransactionJSON;
    return new Transaction(
      json.id,
      toDate(json.date as Date | string),
      json.description,
      json.amount,
      json.type,
      Category.fromId(typeof json.category === 'string' ? json.category : Category.DEFAULT_ID) ?? Category.fromId(Category.DEFAULT_ID)!,
      json.balance,
      json.merchant,
      json.originalText,
      json.budgetMonth,
      json.categoryConfidence,
      json.needsReview,
      json.categorizedBy,
      json.sourceType,
      json.statementId,
      json.cardIssuer,
      json.cardLastFour,
      json.cardHolder,
      json.currency,
      json.originalAmount,
      json.isAnomaly,
      json.anomalyTypes,
      json.anomalyDetails,
      json.anomalyDismissed,
    );
  });
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
  updateCategory: (id: string, categoryId: string, categorizedBy?: CategorizedBy) => void;
  getTransactionsNeedingReview: () => Transaction[];
  // Background categorization
  startBackgroundCategorization: () => void;
  // Anomaly actions
  dismissAnomaly: (id: string) => void;
  restoreAnomaly: (id: string) => void;
  runAnomalyDetection: () => void;
  getActiveAnomalies: () => Transaction[];
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
          transactions: [...state.transactions, ...rehydrateTransactions(txns)],
        })),

      updateTransaction: (id, updates) =>
        set((state) => ({
          transactions: state.transactions.map((txn) => {
            if (txn.id !== id) return txn;
            // Create new Transaction with updates
            return new Transaction(
              updates.id ?? txn.id,
              updates.date ? toDate(updates.date) : txn.date,
              updates.description ?? txn.description,
              updates.amount ?? txn.amount,
              updates.type ?? txn.type,
              updates.category ?? txn.category,
              updates.balance ?? txn.balance,
              updates.merchant ?? txn.merchant,
              updates.originalText ?? txn.originalText,
              updates.budgetMonth ?? txn.budgetMonth,
              updates.categoryConfidence ?? txn.categoryConfidence,
              updates.needsReview ?? txn.needsReview,
              updates.categorizedBy ?? txn.categorizedBy,
              updates.sourceType ?? txn.sourceType,
              updates.statementId ?? txn.statementId,
              updates.cardIssuer ?? txn.cardIssuer,
              updates.cardLastFour ?? txn.cardLastFour,
              updates.cardHolder ?? txn.cardHolder,
              updates.currency ?? txn.currency,
              updates.originalAmount ?? txn.originalAmount,
              updates.isAnomaly ?? txn.isAnomaly,
              updates.anomalyTypes ?? txn.anomalyTypes,
              updates.anomalyDetails ?? txn.anomalyDetails,
              updates.anomalyDismissed ?? txn.anomalyDismissed,
            );
          }),
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
        return get().transactions.filter((txn) => txn.category.id === category);
      },

      getTotalIncome: (startDate, endDate) => {
        let txns = get().transactions.filter((txn) => txn.isIncome);
        if (startDate && endDate) {
          txns = txns.filter((txn) => {
            const d = toDate(txn.date);
            return d >= startDate && d <= endDate;
          });
        }
        return txns.reduce((sum, txn) => sum + txn.amount, 0);
      },

      getTotalExpenses: (startDate, endDate) => {
        let txns = get().transactions.filter((txn) => txn.isExpense);
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
      updateCategory: (id, categoryId, categorizedBy = CategorizedBy.Manual) =>
        set((state) => ({
          transactions: state.transactions.map((txn) => {
            if (txn.id !== id) return txn;
            return new Transaction(
              txn.id,
              txn.date,
              txn.description,
              txn.amount,
              txn.type,
              Category.fromId(categoryId) ?? txn.category,
              txn.balance,
              txn.merchant,
              txn.originalText,
              txn.budgetMonth,
              txn.categoryConfidence,
              false, // needsReview - clear on manual change
              categorizedBy,
              txn.sourceType,
              txn.statementId,
              txn.cardIssuer,
              txn.cardLastFour,
              txn.cardHolder,
              txn.currency,
              txn.originalAmount,
              txn.isAnomaly,
              txn.anomalyTypes,
              txn.anomalyDetails,
              txn.anomalyDismissed,
            );
          }),
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

      // Anomaly actions
      dismissAnomaly: (id) =>
        set((state) => ({
          transactions: state.transactions.map((txn) => {
            if (txn.id !== id) return txn;
            return new Transaction(
              txn.id,
              txn.date,
              txn.description,
              txn.amount,
              txn.type,
              txn.category,
              txn.balance,
              txn.merchant,
              txn.originalText,
              txn.budgetMonth,
              txn.categoryConfidence,
              txn.needsReview,
              txn.categorizedBy,
              txn.sourceType,
              txn.statementId,
              txn.cardIssuer,
              txn.cardLastFour,
              txn.cardHolder,
              txn.currency,
              txn.originalAmount,
              txn.isAnomaly,
              txn.anomalyTypes,
              txn.anomalyDetails,
              true, // anomalyDismissed
            );
          }),
        })),

      restoreAnomaly: (id) =>
        set((state) => ({
          transactions: state.transactions.map((txn) => {
            if (txn.id !== id) return txn;
            return new Transaction(
              txn.id,
              txn.date,
              txn.description,
              txn.amount,
              txn.type,
              txn.category,
              txn.balance,
              txn.merchant,
              txn.originalText,
              txn.budgetMonth,
              txn.categoryConfidence,
              txn.needsReview,
              txn.categorizedBy,
              txn.sourceType,
              txn.statementId,
              txn.cardIssuer,
              txn.cardLastFour,
              txn.cardHolder,
              txn.currency,
              txn.originalAmount,
              txn.isAnomaly,
              txn.anomalyTypes,
              txn.anomalyDetails,
              false, // anomalyDismissed
            );
          }),
        })),

      runAnomalyDetection: () => {
        const { transactions } = get();
        if (transactions.length === 0) return;

        // Dynamic import to avoid circular dependency
        import('@/lib/anomaly/detector').then(({ detectAnomalies }) => {
          const updated = detectAnomalies(transactions);
          set({ transactions: updated });
        });
      },

      getActiveAnomalies: () => {
        return get().transactions.filter(
          (txn) => txn.isAnomaly && !txn.anomalyDismissed
        );
      },
    }),
    {
      name: 'transaction-storage',
      // Rehydrate transactions from JSON to Transaction class instances
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.transactions = rehydrateTransactions(state.transactions);
        }
      },
    }
  )
);
