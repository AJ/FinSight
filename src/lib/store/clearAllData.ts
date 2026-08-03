import { useTransactionStore } from './transactionStore';
import { useChatStore } from './chatStore';
import { useCreditCardStore } from './creditCardStore';
import { useInsightsStore } from './insightsStore';
import { useBudgetStore } from './budgetStore';
import { useMerchantRuleStore } from './merchantRuleStore';
import { useRecurringStore } from './recurringStore';

// The data stores "Clear All Data" wipes. Everything holding the user's financial
// information — imported or derived — is here. Settings and onboarding are
// intentionally excluded: they are setup/config, not data, and wiping them would
// silently discard the user's LLM/connection setup under a "clear data" action.
//
// Call via getState() so this works outside React (e.g. from a unit test or a
// non-component event handler).
export function clearAllUserData(): void {
  useTransactionStore.getState().clearAll();
  useChatStore.getState().clearAll();
  useCreditCardStore.getState().clearStatements();
  useInsightsStore.getState().clear();
  useBudgetStore.getState().clearAll();
  useMerchantRuleStore.getState().clearAll();
  useRecurringStore.getState().clearAll();
}
