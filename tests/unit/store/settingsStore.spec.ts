import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore, calibrationKey } from '@/lib/store/settingsStore';

describe('settingsStore calibration map', () => {
  beforeEach(() => {
    // Start each test on ollama with no model and an empty calibration map.
    useSettingsStore.setState({
      llmProvider: 'ollama',
      llmModel: null,
      llmModelContextLength: null,
      calibrationByModel: {},
    });
  });

  it('stores calibration under the current (provider, model) key', () => {
    useSettingsStore.getState().setLLMModel('qwen3-4b');
    useSettingsStore.getState().setModelCalibration({
      inputCharsPerToken: 2.5,
      outputTokensPerInputLine: 97,
    });
    const s = useSettingsStore.getState();
    expect(s.calibrationByModel[calibrationKey('ollama', 'qwen3-4b')!]).toEqual({
      inputCharsPerToken: 2.5,
      outputTokensPerInputLine: 97,
    });
  });

  it('is a no-op when no model is selected (nothing to cache against)', () => {
    // llmModel is null — setModelCalibration must not invent a key.
    useSettingsStore.getState().setModelCalibration({
      inputCharsPerToken: 2.5,
      outputTokensPerInputLine: 97,
    });
    expect(useSettingsStore.getState().calibrationByModel).toEqual({});
  });

  it('RETAINS calibration when the model switches (each model probed once)', () => {
    // The core guarantee: switching models must not wipe the previous model's ratios.
    useSettingsStore.getState().setLLMModel('qwen3-4b');
    useSettingsStore.getState().setModelCalibration({
      inputCharsPerToken: 2.5,
      outputTokensPerInputLine: 97,
    });

    useSettingsStore.getState().setLLMModel('llama3-8b');

    const s = useSettingsStore.getState();
    // New model is uncalibrated (cache miss)...
    expect(s.calibrationByModel[calibrationKey('ollama', 'llama3-8b')!]).toBeUndefined();
    // ...but qwen's ratios survived the switch.
    expect(s.calibrationByModel[calibrationKey('ollama', 'qwen3-4b')!]).toEqual({
      inputCharsPerToken: 2.5,
      outputTokensPerInputLine: 97,
    });
  });

  it('makes A→B→A a cache hit (revisiting a probed model needs no re-probe)', () => {
    useSettingsStore.getState().setLLMModel('qwen3-4b');
    useSettingsStore.getState().setModelCalibration({
      inputCharsPerToken: 2.5,
      outputTokensPerInputLine: 97,
    });
    useSettingsStore.getState().setLLMModel('llama3-8b');
    useSettingsStore.getState().setModelCalibration({
      inputCharsPerToken: 3.1,
      outputTokensPerInputLine: 88,
    });

    // Switch back to qwen — its entry must still be present.
    useSettingsStore.getState().setLLMModel('qwen3-4b');

    expect(useSettingsStore.getState().calibrationByModel[calibrationKey('ollama', 'qwen3-4b')!]).toEqual({
      inputCharsPerToken: 2.5,
      outputTokensPerInputLine: 97,
    });
  });

  it('RETAINS calibration when the provider switches (keyed by provider too)', () => {
    useSettingsStore.getState().setLLMModel('qwen3-4b');
    useSettingsStore.getState().setModelCalibration({
      inputCharsPerToken: 2.5,
      outputTokensPerInputLine: 97,
    });

    // Provider switch clears the model (model lists differ per provider) but the ollama|qwen
    // calibration entry must survive for when the user returns to it.
    useSettingsStore.getState().setLLMProvider('lmstudio');

    expect(
      useSettingsStore.getState().calibrationByModel[calibrationKey('ollama', 'qwen3-4b')!],
    ).toEqual({ inputCharsPerToken: 2.5, outputTokensPerInputLine: 97 });
  });

  it('does NOT collide between providers serving the same model id', () => {
    // Both providers can serve "qwen3-4b"; their ratios must be stored under distinct keys.
    useSettingsStore.getState().setLLMModel('qwen3-4b');
    useSettingsStore.getState().setModelCalibration({
      inputCharsPerToken: 2.5,
      outputTokensPerInputLine: 97,
    });

    useSettingsStore.getState().setLLMProvider('lmstudio');
    useSettingsStore.getState().setLLMModel('qwen3-4b');
    useSettingsStore.getState().setModelCalibration({
      inputCharsPerToken: 3.3,
      outputTokensPerInputLine: 85,
    });

    const map = useSettingsStore.getState().calibrationByModel;
    expect(map[calibrationKey('ollama', 'qwen3-4b')!].inputCharsPerToken).toBe(2.5);
    expect(map[calibrationKey('lmstudio', 'qwen3-4b')!].inputCharsPerToken).toBe(3.3);
  });

  it('re-affirming the same model id is a no-op (does not clear contextLength)', () => {
    useSettingsStore.getState().setLLMModel('qwen3-4b');
    useSettingsStore.getState().setModelContextLength(8192);
    useSettingsStore.getState().setModelCalibration({
      inputCharsPerToken: 2.5,
      outputTokensPerInputLine: 97,
    });

    useSettingsStore.getState().setLLMModel('qwen3-4b'); // same id — re-affirm

    const s = useSettingsStore.getState();
    expect(s.llmModelContextLength).toBe(8192); // not wiped
    expect(s.calibrationByModel[calibrationKey('ollama', 'qwen3-4b')!].outputTokensPerInputLine).toBe(97);
  });

  it('re-affirming the same provider is a no-op (does not wipe URL or model)', () => {
    // Radix Select fires onValueChange on re-select with no dedup. Re-picking the current
    // provider must not reset the URL to the default or clear the selected model.
    useSettingsStore.getState().setLLMProvider('ollama');
    useSettingsStore.getState().setLLMServerUrl('http://10.0.0.5:11434'); // custom remote URL
    useSettingsStore.getState().setLLMModel('qwen3-4b');

    useSettingsStore.getState().setLLMProvider('ollama'); // re-affirm

    const s = useSettingsStore.getState();
    expect(s.llmServerUrl).toBe('http://10.0.0.5:11434'); // custom URL preserved
    expect(s.llmModel).toBe('qwen3-4b'); // model preserved
  });

  it('clears the cached context length when the model switches (contextLength is single-slot)', () => {
    // contextLength stays a single slot (cheap to re-fetch on connect), so it IS invalidated
    // on a real model change — unlike calibration ratios, which are retained in the map.
    useSettingsStore.getState().setLLMModel('qwen3-4b');
    useSettingsStore.getState().setModelContextLength(8192);
    useSettingsStore.getState().setLLMModel('llama3-8b');
    expect(useSettingsStore.getState().llmModelContextLength).toBeNull();
  });
});
