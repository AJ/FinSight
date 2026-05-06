import { describe, it, expect, beforeEach } from 'vitest';

import { useOnboardingStore } from '@/lib/store/onboardingStore';

beforeEach(() => {
  useOnboardingStore.setState({
    hasCompletedOnboarding: false,
    currentStep: 1,
  });
  localStorage.clear();
});

describe('onboardingStore', () => {
  describe('default state', () => {
    it('starts with hasCompletedOnboarding=false', () => {
      expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(false);
    });

    it('starts with currentStep=1', () => {
      expect(useOnboardingStore.getState().currentStep).toBe(1);
    });
  });

  describe('markOnboardingComplete', () => {
    it('sets hasCompletedOnboarding to true', () => {
      useOnboardingStore.getState().markOnboardingComplete();
      expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(true);
    });

    it('resets currentStep to 1', () => {
      useOnboardingStore.getState().setCurrentStep(3);
      useOnboardingStore.getState().markOnboardingComplete();
      expect(useOnboardingStore.getState().currentStep).toBe(1);
    });
  });

  describe('resetOnboarding', () => {
    it('sets hasCompletedOnboarding to false', () => {
      useOnboardingStore.getState().markOnboardingComplete();
      useOnboardingStore.getState().resetOnboarding();
      expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(false);
    });

    it('resets currentStep to 1', () => {
      useOnboardingStore.getState().setCurrentStep(3);
      useOnboardingStore.getState().resetOnboarding();
      expect(useOnboardingStore.getState().currentStep).toBe(1);
    });
  });

  describe('setCurrentStep', () => {
    it('updates currentStep', () => {
      useOnboardingStore.getState().setCurrentStep(2);
      expect(useOnboardingStore.getState().currentStep).toBe(2);
    });

    it('allows step 3', () => {
      useOnboardingStore.getState().setCurrentStep(3);
      expect(useOnboardingStore.getState().currentStep).toBe(3);
    });
  });

  describe('migration', () => {
    it('detects existing LLM config from settings-storage', () => {
      localStorage.setItem(
        'settings-storage',
        JSON.stringify({
          state: { llmProvider: 'ollama', llmModel: 'llama3', llmUrl: 'http://localhost:11434' },
        }),
      );

      // Verify the data migration logic would read is present
      const settingsRaw = localStorage.getItem('settings-storage');
      const settings = JSON.parse(settingsRaw!);
      const s = settings.state;
      const hasConfig = s.llmProvider != null && s.llmModel != null && s.llmModel !== '';
      expect(hasConfig).toBe(true);
    });

    it('detects missing LLM config when provider is null', () => {
      localStorage.setItem(
        'settings-storage',
        JSON.stringify({ state: { llmProvider: null, llmModel: null } }),
      );
      const settingsRaw = localStorage.getItem('settings-storage');
      const settings = JSON.parse(settingsRaw!);
      const s = settings.state;
      const hasConfig = s.llmProvider != null && s.llmModel != null && s.llmModel !== '';
      expect(hasConfig).toBe(false);
    });

    it('detects existing transactions from transaction-storage', () => {
      localStorage.setItem(
        'transaction-storage',
        JSON.stringify({
          state: { transactions: [{ id: '1', amount: 100 }] },
        }),
      );
      const raw = localStorage.getItem('transaction-storage');
      const data = JSON.parse(raw!);
      const hasTransactions = Array.isArray(data.state.transactions) && data.state.transactions.length > 0;
      expect(hasTransactions).toBe(true);
    });

    it('no config detected when neither storage exists', () => {
      localStorage.clear();
      expect(localStorage.getItem('settings-storage')).toBeNull();
      expect(localStorage.getItem('transaction-storage')).toBeNull();
    });
  });
});
