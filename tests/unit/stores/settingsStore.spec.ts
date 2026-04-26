import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { DEFAULT_URLS } from '@/lib/llm/types';

const initialState = {
  currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  dateFormat: 'auto',
  theme: 'light' as const,
  llmProvider: 'ollama' as const,
  llmServerUrl: DEFAULT_URLS.ollama,
  llmModel: null,
};

describe('useSettingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState(initialState);
  });

  it('setLLMProvider auto-switches URL to localhost for lmstudio', () => {
    useSettingsStore.getState().setLLMProvider('lmstudio');
    expect(useSettingsStore.getState().llmServerUrl).toBe('http://localhost:1234');
  });

  it('setLLMProvider auto-switches URL to localhost for ollama', () => {
    useSettingsStore.getState().setLLMProvider('ollama');
    expect(useSettingsStore.getState().llmServerUrl).toBe('http://localhost:11434');
  });

  it('clears model when switching providers', () => {
    useSettingsStore.getState().setLLMModel('some-model');
    useSettingsStore.getState().setLLMProvider('lmstudio');
    expect(useSettingsStore.getState().llmModel).toBeNull();
  });
});
