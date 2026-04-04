'use client';

import { useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Currency } from '@/types';
import { useSettingsStore } from '@/lib/store/settingsStore';
import Select from 'react-select';
import { reactSelectTheme } from '@/components/ui/react-select-theme';

interface OnboardingStep3Props {
  onComplete: (currency: Currency) => void;
  onBack: () => void;
  initialCurrency: Currency | null;
}

export function OnboardingStep3({ onComplete, onBack, initialCurrency }: OnboardingStep3Props) {
  const [selectedCurrency, setSelectedCurrency] = useState<Currency | null>(initialCurrency);
  const getAvailableCurrencies = useSettingsStore((state) => state.getAvailableCurrencies);
  const availableCurrencies = getAvailableCurrencies();

  // Format currency option for react-select
  const formatCurrencyOption = (currency: Currency | null) => 
    currency ? { value: currency.code, label: `${currency.code} - ${currency.name} (${currency.symbol})` } : null;

  const currencyOptions = useMemo(() => 
    availableCurrencies.map(formatCurrencyOption).filter((opt): opt is { value: string; label: string } => opt !== null), 
    [availableCurrencies]
  );

  const handleContinue = useCallback(() => {
    if (selectedCurrency) {
      onComplete(selectedCurrency);
    }
  }, [onComplete, selectedCurrency]);

  const handleCurrencySelect = useCallback((option: { value: string } | null) => {
    if (option) {
      const currency = availableCurrencies.find((c) => c.code === option.value);
      if (currency) {
        setSelectedCurrency(currency);
      }
    }
  }, [availableCurrencies]);

  const canContinue = selectedCurrency !== null;

  return (
    <div className="space-y-6">
      {/* Currency Selection */}
      <div className="space-y-2">
        <Label htmlFor="currency">Currency</Label>
        
        <Select
          inputId="currency"
          value={formatCurrencyOption(selectedCurrency)}
          onChange={handleCurrencySelect}
          options={currencyOptions}
          placeholder="Search currencies..."
          isSearchable
          className="w-full"
          classNamePrefix="react-select"
          noOptionsMessage={() => 'No currencies found'}
          styles={reactSelectTheme}
        />
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleContinue} disabled={!canContinue}>
          Get Started
        </Button>
      </div>
    </div>
  );
}
