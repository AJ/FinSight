'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { OnboardingStep1 } from './OnboardingStep1';
import { OnboardingStep2 } from './OnboardingStep2';
import { OnboardingStep3 } from './OnboardingStep3';
import { useOnboardingStore } from '@/lib/store/onboardingStore';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { LLMProvider, ModelInfo } from '@/lib/llm/types';
import { Currency } from '@/types';
import { cn } from '@/lib/utils';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'failed';

interface OnboardingState {
  provider: LLMProvider | null;
  serverUrl: string;
  model: string;
  currency: Currency | null;
  connectionStatus: ConnectionStatus;
  models: string[];
  modelInfos: ModelInfo[];
  error: string | null;
}

interface OnboardingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TOTAL_STEPS = 3;

const stepTitles = [
  'Welcome to FinSight',
  'Connect to AI Provider',
  'Select Your Currency',
];

const stepDescriptions = [
  "Let's set up your AI provider to get started",
  'Configure your server connection and select a model',
  'Choose your local currency for all financial displays',
];

export function OnboardingWizard({ open, onOpenChange }: OnboardingWizardProps) {
  const currentStep = useOnboardingStore((state) => state.currentStep);
  const setCurrentStep = useOnboardingStore((state) => state.setCurrentStep);
  const markOnboardingComplete = useOnboardingStore((state) => state.markOnboardingComplete);

  // Reset step on mount — local React state resets on refresh but persisted
  // currentStep does not, causing step 2/3 to render with empty data.
  useEffect(() => {
    setCurrentStep(1);
  }, [setCurrentStep]);

  const [state, setState] = useState<OnboardingState>({
    provider: null,
    serverUrl: '',
    model: '',
    currency: null,
    connectionStatus: 'disconnected',
    models: [],
    modelInfos: [],
    error: null,
  });

  const handleStep1Complete = useCallback((provider: LLMProvider, serverUrl: string, models: string[], modelInfos: ModelInfo[]) => {
    setState((prev) => ({
      ...prev,
      provider,
      serverUrl,
      models,
      modelInfos,
      connectionStatus: 'connected',
    }));
    setCurrentStep(2);
  }, [setCurrentStep]);

  const handleStep2Complete = useCallback((model: string) => {
    setState((prev) => ({ ...prev, model }));
    // Look up context length for the selected model
    const match = state.modelInfos.find(m => m.id === model);
    useSettingsStore.getState().setModelContextLength(match?.contextLength ?? null);
    setCurrentStep(3);
  }, [setCurrentStep, state.modelInfos]);

  const handleStep3Complete = useCallback((currency: Currency) => {
    const settings = useSettingsStore.getState();
    // Order matters: setLLMProvider clears llmModel internally,
    // so setLLMModel must come AFTER setLLMProvider.
    settings.setLLMServerUrl(state.serverUrl);
    settings.setLLMProvider(state.provider!);
    settings.setLLMModel(state.model || null);
    settings.setCurrency(currency);

    markOnboardingComplete();
    onOpenChange(false);
  }, [markOnboardingComplete, onOpenChange, state]);

  const handleBack = useCallback(() => {
    setCurrentStep(currentStep - 1);
  }, [currentStep, setCurrentStep]);

  // Prevent closing modal by clicking outside or pressing Escape
  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (!newOpen) return;
    onOpenChange(newOpen);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[600px]"
        showCloseButton={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{stepTitles[currentStep - 1]}</DialogTitle>
          <DialogDescription>{stepDescriptions[currentStep - 1]}</DialogDescription>
        </DialogHeader>

        {/* Step Progress Indicator */}
        <div className="flex gap-2 py-2">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((step) => (
            <div
              key={step}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors duration-300',
                step <= currentStep ? 'bg-primary' : 'bg-muted'
              )}
            />
          ))}
        </div>

        <div className="py-2">
          {currentStep === 1 && (
            <OnboardingStep1
              onComplete={handleStep1Complete}
              initialProvider={state.provider}
              initialUrl={state.serverUrl}
              initialConnectionStatus={state.connectionStatus}
              initialModels={state.models}
              initialError={state.error}
              onConnectionStatusChange={(status) => setState((prev) => ({ ...prev, connectionStatus: status }))}
              onModelsChange={(models) => setState((prev) => ({ ...prev, models }))}
              onErrorChange={(error) => setState((prev) => ({ ...prev, error }))}
            />
          )}

          {currentStep === 2 && (
            <OnboardingStep2
              onComplete={handleStep2Complete}
              onBack={handleBack}
              initialModel={state.model}
              models={state.models}
              isConnected={state.connectionStatus === 'connected'}
            />
          )}

          {currentStep === 3 && (
            <OnboardingStep3
              onComplete={handleStep3Complete}
              onBack={handleBack}
              initialCurrency={state.currency}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
