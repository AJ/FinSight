'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import Select from 'react-select';
import { reactSelectTheme } from '@/components/ui/react-select-theme';

interface OnboardingStep2Props {
  onComplete: (model: string) => void;
  onBack: () => void;
  initialModel: string;
  models: string[];
  isConnected: boolean;
}

export function OnboardingStep2({
  onComplete,
  onBack,
  initialModel,
  models,
  isConnected,
}: OnboardingStep2Props) {
  const [selectedModel, setSelectedModel] = useState(initialModel);

  const handleContinue = useCallback(() => {
    onComplete(selectedModel);
  }, [onComplete, selectedModel]);

  const canContinue = models.length === 0 || selectedModel !== '';

  return (
    <div className="space-y-6">
      {/* Model Selection */}
      <div className={cn('space-y-2', !isConnected && 'opacity-50 pointer-events-none')}>
        <Label htmlFor="model">AI Model</Label>
        <Select
          inputId="model"
          value={selectedModel ? { value: selectedModel, label: selectedModel } : null}
          onChange={(option) => setSelectedModel(option?.value || '')}
          options={models.map((m) => ({ value: m, label: m }))}
          placeholder="Select a model..."
          isSearchable
          isDisabled={!isConnected}
          className="w-full"
          classNamePrefix="react-select"
          noOptionsMessage={() => 'No models found'}
          styles={reactSelectTheme}
        />
        {models.length === 0 && isConnected && (
          <p className="text-xs text-amber-600">
            No models available. Configure later in Settings.
          </p>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleContinue} disabled={!canContinue}>
          Continue
        </Button>
      </div>
    </div>
  );
}
