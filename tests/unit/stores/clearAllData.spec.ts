import { describe, it, expect, beforeEach } from 'vitest';

import { clearAllUserData } from '@/lib/store/clearAllData';
import { useTransactionStore } from '@/lib/store/transactionStore';
import { useChatStore } from '@/lib/store/chatStore';
import { useCreditCardStore } from '@/lib/store/creditCardStore';
import { useInsightsStore } from '@/lib/store/insightsStore';
import { useBudgetStore } from '@/lib/store/budgetStore';
import { useMerchantRuleStore } from '@/lib/store/merchantRuleStore';
import { useRecurringStore } from '@/lib/store/recurringStore';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { useOnboardingStore } from '@/lib/store/onboardingStore';
import { useCategoryStore } from '@/lib/store/categoryStore';
import { makeTransactions } from '@tests/unit/factories';
import type { CreditCardStatement } from '@/types/creditCard';
import type { Insight } from '@/lib/insights/types';
import type { MerchantRuleDecision } from '@/lib/categorization/merchantRules';
import type { RecurringPayment } from '@/lib/recurring/types';
import { SourceType } from '@/models';

// Strip action functions so we can deep-compare only the persisted data slices.
// Functions live on the store instance and are stable across the call; we only
// care that no DATA field on the config stores changed.
function dataSnapshot<T extends object>(state: T): unknown {
  return JSON.parse(JSON.stringify(state));
}

function makeStatement(): CreditCardStatement {
  return {
    id: 'stmt-1',
    fileName: 'statement.pdf',
    parseDate: new Date('2024-06-01'),
    cardLastFour: '1234',
    cardIssuer: 'HDFC',
    statementPeriod: { start: new Date('2024-05-01'), end: new Date('2024-05-31') },
    statementDate: new Date('2024-06-01'),
    paymentDueDate: new Date('2024-06-20'),
    totalDue: 50000,
    minimumDue: 2500,
    creditLimit: 200000,
    availableCredit: 150000,
    previousBalance: 45000,
    paymentsReceived: 45000,
    purchasesAndCharges: 50000,
    interestCharged: 0,
    lateFee: 0,
    isPaid: false,
  };
}

describe('clearAllUserData', () => {
  beforeEach(() => {
    // Start every data store empty so the seed is deterministic.
    useTransactionStore.getState().clearAll();
    useChatStore.getState().clearAll();
    useCreditCardStore.setState({ statements: [], isParsing: false });
    useInsightsStore.getState().clear();
    useBudgetStore.getState().clearAll();
    useMerchantRuleStore.setState({ rules: [] });
    useRecurringStore.setState({
      recurringPayments: [],
      excludedMerchants: [],
      lastScanned: null,
      isScanning: false,
    });
  });

  it('empties every data store', () => {
    // Seed each data store with at least one real item via its public API.
    useTransactionStore.getState().addTransactions(makeTransactions(2));
    useChatStore.getState().addMessage({
      id: 'm1',
      content: 'hi',
      role: 'user',
      timestamp: new Date().toISOString(),
    });
    useCreditCardStore.getState().addStatement(makeStatement());
    useInsightsStore.getState().setInsights([
      {
        id: 'i1',
        type: 'category_trend',
        title: 't',
        description: 'd',
        severity: 'info',
        category: 'shopping',
      } as Insight,
    ]);
    useBudgetStore.getState().setIncome('2026-04', 50000);
    useBudgetStore.getState().setAllocation('2026-04', 'groceries', 10000);
    useBudgetStore.getState().savePeriod('2026-04');
    useMerchantRuleStore.getState().upsertRule({
      merchantKey: 'AMAZON',
      categoryId: 'shopping',
      direction: 'debit',
      sourceType: SourceType.Bank,
      sampleDescription: 'Amazon purchase',
    } satisfies MerchantRuleDecision);
    const recurring: RecurringPayment = {
      id: 'rp-1',
      merchantName: 'Netflix',
      originalMerchantNames: ['NETFLIX.COM'],
      category: 'entertainment',
      amount: 499,
      averageAmount: 499,
      frequency: 'monthly',
      confidence: 0.95,
      firstSeen: new Date('2024-01-01'),
      lastSeen: new Date('2024-05-01'),
      occurrenceCount: 5,
      transactionIds: ['t1', 't2', 't3', 't4', 't5'],
      isActive: true,
      nextExpectedDate: new Date('2024-06-01'),
      status: 'active',
    };
    useRecurringStore.setState({
      recurringPayments: [recurring],
      excludedMerchants: [{ normalizedName: 'spotify', excludedAt: new Date('2024-01-01') }],
      lastScanned: new Date('2024-05-30'),
      isScanning: false,
    });

    // Sanity: the seed actually took.
    expect(useTransactionStore.getState().transactions).toHaveLength(2);
    expect(useCreditCardStore.getState().statements).toHaveLength(1);
    expect(useBudgetStore.getState().getPeriod('2026-04')).not.toBeNull();
    expect(useMerchantRuleStore.getState().listRules()).toHaveLength(1);
    expect(useRecurringStore.getState().recurringPayments).toHaveLength(1);

    clearAllUserData();

    // Every data store is now empty / reset to its initial shape.
    expect(useTransactionStore.getState().transactions).toHaveLength(0);
    expect(useTransactionStore.getState().bankSummaries).toHaveLength(0);
    expect(useTransactionStore.getState().selectedIds).toHaveLength(0);
    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(useChatStore.getState().selectedModel).toBeNull();
    expect(useCreditCardStore.getState().statements).toHaveLength(0);
    expect(useInsightsStore.getState().insights).toHaveLength(0);
    expect(useInsightsStore.getState().generatedAt).toBeNull();
    expect(Object.keys(useBudgetStore.getState().periods)).toHaveLength(0);
    expect(useBudgetStore.getState().notifications).toEqual({
      dismissedNoBudget: null,
      dismissedEOM: null,
    });
    expect(useMerchantRuleStore.getState().rules).toHaveLength(0);
    expect(useRecurringStore.getState().recurringPayments).toHaveLength(0);
    expect(useRecurringStore.getState().excludedMerchants).toHaveLength(0);
    expect(useRecurringStore.getState().lastScanned).toBeNull();
  });

  it('leaves settings, onboarding, and the category catalog untouched', () => {
    // Put the config stores into a non-default state.
    useSettingsStore.setState({ llmModel: 'keep-this-model', llmProvider: 'ollama' });
    useOnboardingStore.getState().markOnboardingComplete();
    useCategoryStore.getState().initializeDefaultCategories();

    const settingsBefore = dataSnapshot(useSettingsStore.getState());
    const onboardingBefore = dataSnapshot(useOnboardingStore.getState());
    const categoryBefore = dataSnapshot(useCategoryStore.getState());

    clearAllUserData();

    expect(dataSnapshot(useSettingsStore.getState())).toEqual(settingsBefore);
    expect(dataSnapshot(useOnboardingStore.getState())).toEqual(onboardingBefore);
    expect(dataSnapshot(useCategoryStore.getState())).toEqual(categoryBefore);

    // Explicit pinning of the fields that matter most (regression guard: if
    // someone wires settings/category/onboarding into the wipe, these fail).
    expect(useSettingsStore.getState().llmModel).toBe('keep-this-model');
    expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(true);
    expect(useCategoryStore.getState().categories.length).toBeGreaterThan(0);
  });
});
