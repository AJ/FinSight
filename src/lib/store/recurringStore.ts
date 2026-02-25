import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { RecurringPayment, detectRecurringPayments, DEFAULT_DETECTION_CONFIG } from '@/lib/recurring';
import { Transaction } from '@/types';

/** Rehydrate Date objects from JSON strings */
function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

/** Rehydrate all date fields in recurring payments */
function rehydrateDates(payments: RecurringPayment[]): RecurringPayment[] {
  return payments.map((p) => ({
    ...p,
    firstSeen: toDate(p.firstSeen),
    lastSeen: toDate(p.lastSeen),
    nextExpectedDate: p.nextExpectedDate ? toDate(p.nextExpectedDate) : undefined,
  }));
}

// Track transactions that user has marked as "not recurring"
interface ExcludedMerchant {
  normalizedName: string;
  excludedAt: Date;
}

interface RecurringStore {
  recurringPayments: RecurringPayment[];
  excludedMerchants: ExcludedMerchant[];
  lastScanned: Date | null;
  isScanning: boolean;

  // Actions
  scanTransactions: (transactions: Transaction[]) => void;
  updatePayment: (id: string, updates: Partial<RecurringPayment>) => void;
  markAsNotRecurring: (id: string, normalizedName: string) => void;
  clearExcludedMerchants: () => void;
  getActivePayments: () => RecurringPayment[];
  getInactivePayments: () => RecurringPayment[];
  getTotalMonthlyRecurring: () => number;
}

export const useRecurringStore = create<RecurringStore>()(
  persist(
    (set, get) => ({
      recurringPayments: [],
      excludedMerchants: [],
      lastScanned: null,
      isScanning: false,

      scanTransactions: (transactions: Transaction[]) => {
        if (get().isScanning) return;

        set({ isScanning: true });

        try {
          const excluded = get().excludedMerchants.map(e => e.normalizedName.toLowerCase());

          // Run detection
          const detected = detectRecurringPayments(transactions, DEFAULT_DETECTION_CONFIG);

          // Filter out excluded merchants
          const filtered = detected.filter(p =>
            !excluded.some(ex =>
              p.merchantName.toLowerCase().includes(ex) ||
              ex.includes(p.merchantName.toLowerCase())
            )
          );

          set({
            recurringPayments: filtered,
            lastScanned: new Date(),
            isScanning: false,
          });
        } catch (error) {
          console.error('[RecurringStore] Scan failed:', error);
          set({ isScanning: false });
        }
      },

      updatePayment: (id, updates) =>
        set((state) => ({
          recurringPayments: state.recurringPayments.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        })),

      markAsNotRecurring: (id, normalizedName) =>
        set((state) => {
          // Add to excluded list
          const newExcluded: ExcludedMerchant = {
            normalizedName: normalizedName.toLowerCase(),
            excludedAt: new Date(),
          };

          // Remove from recurring payments
          const filtered = state.recurringPayments.filter(p => p.id !== id);

          return {
            recurringPayments: filtered,
            excludedMerchants: [...state.excludedMerchants, newExcluded],
          };
        }),

      clearExcludedMerchants: () =>
        set({ excludedMerchants: [] }),

      getActivePayments: () =>
        get().recurringPayments.filter(p => p.isActive),

      getInactivePayments: () =>
        get().recurringPayments.filter(p => !p.isActive),

      getTotalMonthlyRecurring: () => {
        const { recurringPayments } = get();
        return recurringPayments
          .filter(p => p.isActive)
          .reduce((sum, p) => {
            // Convert to monthly equivalent
            let monthlyAmount = p.amount;
            switch (p.frequency) {
              case 'weekly':
                monthlyAmount = p.amount * 4.33;
                break;
              case 'quarterly':
                monthlyAmount = p.amount / 3;
                break;
              case 'yearly':
                monthlyAmount = p.amount / 12;
                break;
            }
            return sum + monthlyAmount;
          }, 0);
      },
    }),
    {
      name: 'recurring-storage',
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.recurringPayments = rehydrateDates(state.recurringPayments);
          state.excludedMerchants = state.excludedMerchants.map(e => ({
            ...e,
            excludedAt: toDate(e.excludedAt),
          }));
          if (state.lastScanned) {
            state.lastScanned = toDate(state.lastScanned);
          }
        }
      },
    }
  )
);
