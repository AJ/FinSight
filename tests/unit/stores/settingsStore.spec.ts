import { describe, it, expect } from 'vitest';
import { useSettingsStore } from '@/lib/store/settingsStore';

describe('useSettingsStore', () => {
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
