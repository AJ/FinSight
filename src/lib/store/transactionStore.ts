import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Transaction, Category, TransactionJSON, CategorizedBy } from '@/types';
import { useSettingsStore } from './settingsStore';
import { deduplicateTransactions } from '@/lib/transactionUtils';
import { merchantRuleRepository } from './merchantRuleStore';
import { getMerchantRuleDecision } from '@/lib/categorization/merchantRules';
import { debugError } from '@/lib/utils/debug';
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
    if (t instanceof Transaction) {
      return Transaction.fromJSON({
        ...t.toJSON(),
        date: toDate(t.date).toISOString(),
      });
    }
    // Otherwise reconstruct from JSON-like object
    const json = t as unknown as TransactionJSON;
    return Transaction.fromJSON({
      ...json,
      date: toDate(json.date as Date | string).toISOString(),
      category:
        typeof json.category === 'string' ? json.category : Category.DEFAULT_ID,
    });
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
        set((state) => {
          const rehydrated = rehydrateTransactions(txns);
          const unique = deduplicateTransactions(rehydrated, state.transactions);
          if (unique.length < rehydrated.length) {
            console.log(`[Store] Filtered ${rehydrated.length - unique.length} duplicate transaction(s)`);
          }
          return {
            transactions: [...state.transactions, ...unique],
          };
        }),

      updateTransaction: (id, updates) =>
        set((state) => ({
          transactions: state.transactions.map((txn) => {
            if (txn.id !== id) return txn;

            // Accept either Category instance or category ID string from callers.
            const resolvedCategory = (() => {
              const incoming = updates.category as unknown;
              if (typeof incoming === 'string') {
                return Category.fromId(incoming) ?? txn.category;
              }
              if (incoming instanceof Category) {
                return incoming;
              }
              return txn.category;
            })();

            return Transaction.fromJSON({
              ...txn.toJSON(),
              id: updates.id ?? txn.id,
              date: updates.date
                ? toDate(updates.date).toISOString()
                : txn.date.toISOString(),
              description: updates.description ?? txn.description,
              amount: updates.amount ?? txn.amount,
              type: updates.type ?? txn.type,
              category: resolvedCategory.id,
              balance: updates.balance ?? txn.balance,
              merchant: updates.merchant ?? txn.merchant,
              originalText: updates.originalText ?? txn.originalText,
              budgetMonth: updates.budgetMonth ?? txn.budgetMonth,
              categoryConfidence:
                updates.categoryConfidence ?? txn.categoryConfidence,
              needsReview: updates.needsReview ?? txn.needsReview,
              categorizedBy: updates.categorizedBy ?? txn.categorizedBy,
              sourceType: updates.sourceType ?? txn.sourceType,
              statementId: updates.statementId ?? txn.statementId,
              cardIssuer: updates.cardIssuer ?? txn.cardIssuer,
              cardLastFour: updates.cardLastFour ?? txn.cardLastFour,
              cardHolder: updates.cardHolder ?? txn.cardHolder,
              localCurrency: updates.localCurrency ?? txn.localCurrency,
              originalCurrency: updates.originalCurrency ?? txn.originalCurrency,
              originalAmount: updates.originalAmount ?? txn.originalAmount,
              isInternational: updates.isInternational ?? txn.isInternational,
              isAnomaly: updates.isAnomaly ?? txn.isAnomaly,
              anomalyTypes: updates.anomalyTypes ?? txn.anomalyTypes,
              anomalyDetails: updates.anomalyDetails ?? txn.anomalyDetails,
              anomalyDismissed:
                updates.anomalyDismissed ?? txn.anomalyDismissed,
              transactionSubType:
                updates.transactionSubType ?? txn.transactionSubType,
              suggestedCategory:
                updates.suggestedCategory ?? txn.suggestedCategory,
              llmConfidence: updates.llmConfidence ?? txn.llmConfidence,
              verificationConfidence:
                updates.verificationConfidence ?? txn.verificationConfidence,
            });
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
      updateCategory: (id, categoryId, categorizedBy = CategorizedBy.Manual) => {
        let learnedTransaction: Transaction | null = null;

        set((state) => ({
          transactions: state.transactions.map((txn) => {
            if (txn.id !== id) return txn;

            const updated = Transaction.fromJSON({
              ...txn.toJSON(),
              category: (Category.fromId(categoryId) ?? txn.category).id,
              needsReview: false,
              categorizedBy,
            });

            learnedTransaction = updated;
            return updated;
          }),
        }));

        if (categorizedBy === CategorizedBy.Manual && learnedTransaction) {
          const decision = getMerchantRuleDecision(learnedTransaction);
          if (decision) {
            merchantRuleRepository.upsertRule(decision);
          }
        }
      },

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
            const autoCategorizeCandidates = get().transactions.filter(
              (transaction) => transaction.categorizedBy !== CategorizedBy.Manual
            );

            if (autoCategorizeCandidates.length === 0) {
              set({ isCategorizing: false, categorizeProgress: '' });
              return;
            }

            // Get settings
            const settings = useSettingsStore.getState();
            const { llmProvider, llmServerUrl, llmModel } = settings;

            // Lazy load categorizer to avoid circular deps
            if (!categorizationPromise) {
              categorizationPromise = import('@/lib/categorization/aiCategorizer');
            }
            const { categorizeTransactions, applyCategorizationResults } = await categorizationPromise;

            // Run categorization
            const results = await categorizeTransactions(
              autoCategorizeCandidates,
              {
                provider: llmProvider,
                baseUrl: llmServerUrl,
                model: llmModel || undefined,
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
            debugError('BackgroundCategorization', error);
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
            return Transaction.fromJSON({
              ...txn.toJSON(),
              anomalyDismissed: true,
            });
          }),
        })),

      restoreAnomaly: (id) =>
        set((state) => ({
          transactions: state.transactions.map((txn) => {
            if (txn.id !== id) return txn;
            return Transaction.fromJSON({
              ...txn.toJSON(),
              anomalyDismissed: false,
            });
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
