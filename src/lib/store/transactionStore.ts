import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Transaction, Category, TransactionJSON, CategorizedBy } from '@/types';
import { useSettingsStore } from './settingsStore';
import { deduplicateTransactions } from '@/lib/transactionUtils';
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
        t.id, // id
        toDate(t.date), // date
        t.description, // description
        t.amount, // amount
        t.type, // type
        t.category instanceof Category ? t.category : Category.fromId(typeof t.category === 'string' ? t.category : Category.DEFAULT_ID) ?? Category.fromId(Category.DEFAULT_ID)!, // category
        t.balance, // balance
        t.merchant, // merchant
        t.originalText, // originalText
        t.budgetMonth, // budgetMonth
        t.categoryConfidence, // categoryConfidence
        t.needsReview, // needsReview
        t.categorizedBy, // categorizedBy
        t.sourceType, // sourceType
        t.statementId, // statementId
        t.cardIssuer, // cardIssuer
        t.cardLastFour, // cardLastFour
        t.cardHolder, // cardHolder
        t.localCurrency, // localCurrency
        t.originalCurrency, // originalCurrency
        t.originalAmount, // originalAmount
        t.isInternational, // isInternational
        t.isAnomaly, // isAnomaly
        t.anomalyTypes, // anomalyTypes
        t.anomalyDetails, // anomalyDetails
        t.anomalyDismissed, // anomalyDismissed
        t.transactionSubType, // transactionSubType
        t.suggestedCategory, // suggestedCategory
      );
    }
    // Otherwise reconstruct from JSON-like object
    const json = t as unknown as TransactionJSON;
    return new Transaction(
      json.id, // id
      toDate(json.date as Date | string), // date
      json.description, // description
      json.amount, // amount
      json.type, // type
      Category.fromId(typeof json.category === 'string' ? json.category : Category.DEFAULT_ID) ?? Category.fromId(Category.DEFAULT_ID)!, // category
      json.balance, // balance
      json.merchant, // merchant
      json.originalText, // originalText
      json.budgetMonth, // budgetMonth
      json.categoryConfidence, // categoryConfidence
      json.needsReview, // needsReview
      json.categorizedBy, // categorizedBy
      json.sourceType, // sourceType
      json.statementId, // statementId
      json.cardIssuer, // cardIssuer
      json.cardLastFour, // cardLastFour
      json.cardHolder, // cardHolder
      json.localCurrency, // localCurrency
      json.originalCurrency, // originalCurrency
      json.originalAmount, // originalAmount
      json.isInternational, // isInternational
      json.isAnomaly, // isAnomaly
      json.anomalyTypes, // anomalyTypes
      json.anomalyDetails, // anomalyDetails
      json.anomalyDismissed, // anomalyDismissed
      json.transactionSubType, // transactionSubType
      json.suggestedCategory, // suggestedCategory
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

            // Create new Transaction with updates
            return new Transaction(
              updates.id ?? txn.id, // id
              updates.date ? toDate(updates.date) : txn.date, // date
              updates.description ?? txn.description, // description
              updates.amount ?? txn.amount, // amount
              updates.type ?? txn.type, // type
              resolvedCategory, // category
              updates.balance ?? txn.balance, // balance
              updates.merchant ?? txn.merchant, // merchant
              updates.originalText ?? txn.originalText, // originalText
              updates.budgetMonth ?? txn.budgetMonth, // budgetMonth
              updates.categoryConfidence ?? txn.categoryConfidence, // categoryConfidence
              updates.needsReview ?? txn.needsReview, // needsReview
              updates.categorizedBy ?? txn.categorizedBy, // categorizedBy
              updates.sourceType ?? txn.sourceType, // sourceType
              updates.statementId ?? txn.statementId, // statementId
              updates.cardIssuer ?? txn.cardIssuer, // cardIssuer
              updates.cardLastFour ?? txn.cardLastFour, // cardLastFour
              updates.cardHolder ?? txn.cardHolder, // cardHolder
              updates.localCurrency ?? txn.localCurrency, // localCurrency
              updates.originalCurrency ?? txn.originalCurrency, // originalCurrency
              updates.originalAmount ?? txn.originalAmount, // originalAmount
              updates.isInternational ?? txn.isInternational, // isInternational
              updates.isAnomaly ?? txn.isAnomaly, // isAnomaly
              updates.anomalyTypes ?? txn.anomalyTypes, // anomalyTypes
              updates.anomalyDetails ?? txn.anomalyDetails, // anomalyDetails
              updates.anomalyDismissed ?? txn.anomalyDismissed, // anomalyDismissed
              updates.transactionSubType ?? txn.transactionSubType, // transactionSubType
              updates.suggestedCategory ?? txn.suggestedCategory, // suggestedCategory
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
              txn.id, // id
              txn.date, // date
              txn.description, // description
              txn.amount, // amount
              txn.type, // type
              Category.fromId(categoryId) ?? txn.category, // category
              txn.balance, // balance
              txn.merchant, // merchant
              txn.originalText, // originalText
              txn.budgetMonth, // budgetMonth
              txn.categoryConfidence, // categoryConfidence
              false, // needsReview - clear on manual change
              categorizedBy, // categorizedBy
              txn.sourceType, // sourceType
              txn.statementId, // statementId
              txn.cardIssuer, // cardIssuer
              txn.cardLastFour, // cardLastFour
              txn.cardHolder, // cardHolder
              txn.localCurrency, // localCurrency
              txn.originalCurrency, // originalCurrency
              txn.originalAmount, // originalAmount
              txn.isInternational, // isInternational
              txn.isAnomaly, // isAnomaly
              txn.anomalyTypes, // anomalyTypes
              txn.anomalyDetails, // anomalyDetails
              txn.anomalyDismissed, // anomalyDismissed
              txn.transactionSubType, // transactionSubType
              txn.suggestedCategory, // suggestedCategory
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
              txn.id, // id
              txn.date, // date
              txn.description, // description
              txn.amount, // amount
              txn.type, // type
              txn.category, // category
              txn.balance, // balance
              txn.merchant, // merchant
              txn.originalText, // originalText
              txn.budgetMonth, // budgetMonth
              txn.categoryConfidence, // categoryConfidence
              txn.needsReview, // needsReview
              txn.categorizedBy, // categorizedBy
              txn.sourceType, // sourceType
              txn.statementId, // statementId
              txn.cardIssuer, // cardIssuer
              txn.cardLastFour, // cardLastFour
              txn.cardHolder, // cardHolder
              txn.localCurrency, // localCurrency
              txn.originalCurrency, // originalCurrency
              txn.originalAmount, // originalAmount
              txn.isInternational, // isInternational
              txn.isAnomaly, // isAnomaly
              txn.anomalyTypes, // anomalyTypes
              txn.anomalyDetails, // anomalyDetails
              true, // anomalyDismissed
              txn.transactionSubType, // transactionSubType
              txn.suggestedCategory, // suggestedCategory
            );
          }),
        })),

      restoreAnomaly: (id) =>
        set((state) => ({
          transactions: state.transactions.map((txn) => {
            if (txn.id !== id) return txn;
            return new Transaction(
              txn.id, // id
              txn.date, // date
              txn.description, // description
              txn.amount, // amount
              txn.type, // type
              txn.category, // category
              txn.balance, // balance
              txn.merchant, // merchant
              txn.originalText, // originalText
              txn.budgetMonth, // budgetMonth
              txn.categoryConfidence, // categoryConfidence
              txn.needsReview, // needsReview
              txn.categorizedBy, // categorizedBy
              txn.sourceType, // sourceType
              txn.statementId, // statementId
              txn.cardIssuer, // cardIssuer
              txn.cardLastFour, // cardLastFour
              txn.cardHolder, // cardHolder
              txn.localCurrency, // localCurrency
              txn.originalCurrency, // originalCurrency
              txn.originalAmount, // originalAmount
              txn.isInternational, // isInternational
              txn.isAnomaly, // isAnomaly
              txn.anomalyTypes, // anomalyTypes
              txn.anomalyDetails, // anomalyDetails
              false, // anomalyDismissed
              txn.transactionSubType, // transactionSubType
              txn.suggestedCategory, // suggestedCategory
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

