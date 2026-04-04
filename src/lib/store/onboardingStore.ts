/**
 * Onboarding state management.
 * Tracks whether the user has completed the first-run onboarding flow.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface OnboardingStore {
  hasCompletedOnboarding: boolean;
  currentStep: number;
  markOnboardingComplete: () => void;
  resetOnboarding: () => void;
  setCurrentStep: (step: number) => void;
}

export const useOnboardingStore = create<OnboardingStore>()(
  persist(
    (set) => ({
      hasCompletedOnboarding: false,
      currentStep: 1,
      markOnboardingComplete: () => set({ hasCompletedOnboarding: true, currentStep: 1 }),
      resetOnboarding: () => set({ hasCompletedOnboarding: false, currentStep: 1 }),
      setCurrentStep: (step) => set({ currentStep: step }),
    }),
    {
      name: 'onboarding-storage',
      migrate: (persisted) => {
        // Migration v0 → v1: Mark existing users as completed
        const state = persisted as Record<string, unknown>;
        if (state.hasCompletedOnboarding === undefined) {
          // Check if user has existing LLM configuration from localStorage
          // We check localStorage directly because settings store might not be hydrated yet
          try {
            const settingsRaw = localStorage.getItem('settings-storage');
            const transactionsRaw = localStorage.getItem('transaction-storage');
            
            let hasExistingConfig = false;
            
            if (settingsRaw) {
              const settings = JSON.parse(settingsRaw);
              const settingsState = settings.state as Record<string, unknown>;
              hasExistingConfig = 
                settingsState.llmProvider !== null &&
                settingsState.llmProvider !== undefined &&
                settingsState.llmModel !== null &&
                settingsState.llmModel !== undefined &&
                settingsState.llmModel !== '';
            }
            
            // Also check if user has any transactions
            if (!hasExistingConfig && transactionsRaw) {
              const transactionsData = JSON.parse(transactionsRaw);
              const transactionsState = transactionsData.state as Record<string, unknown>;
              const transactionList = transactionsState.transactions as unknown[];
              hasExistingConfig = Array.isArray(transactionList) && transactionList.length > 0;
            }
              
            state.hasCompletedOnboarding = hasExistingConfig;
            state.currentStep = 1;
          } catch {
            // If we can't read settings, assume new user
            state.hasCompletedOnboarding = false;
            state.currentStep = 1;
          }
        }
        return state as unknown as OnboardingStore;
      },
      version: 1,
    }
  )
);
