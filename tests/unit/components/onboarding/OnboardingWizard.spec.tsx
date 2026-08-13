import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { LLMProvider, LLMRuntimeConfig, ModelInfo } from '@/lib/llm/types';
import type { Currency } from '@/types';

// ─── Module mocks ───────────────────────────────────────────────────────────
//
// The three step components are replaced with single-button stubs so the test
// can drive the wizard forward deterministically. Each stub's prop type mirrors
// the real component's onComplete signature (read from OnboardingStepN.tsx).
// The wizard wires several other props to each step, but the stubs ignore them
// — only onComplete is exercised here. No `any`: each stub argument is typed
// against a minimal interface matching the real onComplete contract.

interface Step1StubProps {
  onComplete: (
    provider: LLMProvider,
    serverUrl: string,
    models: string[],
    modelInfos: ModelInfo[],
  ) => void;
}
interface Step2StubProps {
  onComplete: (model: string) => void;
}
interface Step3StubProps {
  onComplete: (currency: Currency) => void;
}

vi.mock('@/components/onboarding/OnboardingStep1', () => ({
  OnboardingStep1: ({ onComplete }: Step1StubProps) => (
    <button type="button" onClick={() => onComplete('ollama', 'http://localhost:11434', ['m1'], [])}>
      s1
    </button>
  ),
}));
vi.mock('@/components/onboarding/OnboardingStep2', () => ({
  OnboardingStep2: ({ onComplete }: Step2StubProps) => (
    <button type="button" onClick={() => onComplete('m1')}>
      s2
    </button>
  ),
}));
vi.mock('@/components/onboarding/OnboardingStep3', () => ({
  OnboardingStep3: ({ onComplete }: Step3StubProps) => (
    <button
      type="button"
      onClick={() => onComplete({ code: 'INR', symbol: '₹', name: 'Indian Rupee' })}
    >
      s3
    </button>
  ),
}));

const ensureModelCalibratedMock: Mock<(cfg: LLMRuntimeConfig) => Promise<void>> =
  vi.fn();
vi.mock('@/lib/llm/calibrationProbe', () => ({
  ensureModelCalibrated: (cfg: LLMRuntimeConfig) => ensureModelCalibratedMock(cfg),
}));

import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { useOnboardingStore } from '@/lib/store/onboardingStore';
import { useSettingsStore } from '@/lib/store/settingsStore';

describe('OnboardingWizard — proactive token-ratio calibration', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset wizard to step 1 and clear any persisted calibration so the
    // cache-hit branch in ensureModelCalibrated can't short-circuit the call.
    useOnboardingStore.setState({ hasCompletedOnboarding: false, currentStep: 1 });
    useSettingsStore.setState({
      llmProvider: 'ollama',
      llmServerUrl: '',
      llmModel: null,
      llmModelContextLength: null,
      calibrationByModel: {},
    });
    ensureModelCalibratedMock.mockReset();
    ensureModelCalibratedMock.mockResolvedValue(undefined);
  });

  it('fires ensureModelCalibrated after step 3 completes, with the config the wizard collected', async () => {
    render(<OnboardingWizard open={true} onOpenChange={() => {}} />);

    fireEvent.click(screen.getByText('s1'));
    fireEvent.click(screen.getByText('s2'));

    // Spy before step 3 fires handleStep3Complete, so setLLMModel's call is
    // recorded. (Only step 3 calls setLLMModel; steps 1-2 update local state.)
    const setLLMModelMock = vi.spyOn(useSettingsStore.getState(), 'setLLMModel');

    fireEvent.click(screen.getByText('s3'));

    // handleStep3Complete is async; waitFor bridges the synchronous click and
    // the awaited probe call.
    await waitFor(() => {
      expect(ensureModelCalibratedMock).toHaveBeenCalledWith({
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
        model: 'm1',
      });
    });

    // Ordering is load-bearing: setLLMModel clears the calibration cache, so the
    // probe MUST run AFTER it — calibrating first would have its ratios wiped.
    // invocationCallOrder is a global counter across all mocks, so comparing the
    // first call index of each pins the temporal order.
    expect(setLLMModelMock).toHaveBeenCalledWith('m1');
    expect(setLLMModelMock.mock.invocationCallOrder[0]).toBeLessThan(
      ensureModelCalibratedMock.mock.invocationCallOrder[0],
    );
    setLLMModelMock.mockRestore();
  });
});
