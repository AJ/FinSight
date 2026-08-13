import { describe, it, expect, afterEach } from 'vitest';
import {
  getInputCharsPerToken,
  getOutputTokensPerInputLine,
  DEFAULT_OUTPUT_TOKENS_PER_LINE,
} from '@/lib/llm/contextWindow';
import { useSettingsStore, calibrationKey } from '@/lib/store/settingsStore';

describe('calibrated accessors', () => {
  afterEach(() => {
    useSettingsStore.setState({
      llmProvider: 'ollama',
      llmModel: null,
      calibrationByModel: {},
    });
  });

  it('fall back to CHARS_PER_TOKEN / DEFAULT_OUTPUT_TOKENS_PER_LINE when uncached', () => {
    // A model is selected but has no calibration entry → defaults.
    useSettingsStore.setState({ llmProvider: 'ollama', llmModel: 'qwen3-4b', calibrationByModel: {} });
    expect(getInputCharsPerToken()).toBe(2.3);
    expect(getOutputTokensPerInputLine()).toBe(DEFAULT_OUTPUT_TOKENS_PER_LINE);
    expect(DEFAULT_OUTPUT_TOKENS_PER_LINE).toBeGreaterThanOrEqual(80);
  });

  it('fall back when no model is selected (no key to look up)', () => {
    useSettingsStore.setState({ llmProvider: 'ollama', llmModel: null, calibrationByModel: {} });
    expect(getInputCharsPerToken()).toBe(2.3);
    expect(getOutputTokensPerInputLine()).toBe(DEFAULT_OUTPUT_TOKENS_PER_LINE);
  });

  it('return cached values when calibration is present for the current model', () => {
    useSettingsStore.setState({
      llmProvider: 'ollama',
      llmModel: 'qwen3-4b',
      calibrationByModel: {
        [calibrationKey('ollama', 'qwen3-4b')!]: { inputCharsPerToken: 2.5, outputTokensPerInputLine: 97 },
      },
    });
    expect(getInputCharsPerToken()).toBe(2.5);
    expect(getOutputTokensPerInputLine()).toBe(97);
  });

  it('read the CURRENT model entry, not a stale one from another model', () => {
    // qwen is calibrated; switching to llama (uncalibrated) must fall back, not leak qwen's value.
    useSettingsStore.setState({
      llmProvider: 'ollama',
      llmModel: 'llama3-8b',
      calibrationByModel: {
        [calibrationKey('ollama', 'qwen3-4b')!]: { inputCharsPerToken: 2.5, outputTokensPerInputLine: 97 },
      },
    });
    expect(getInputCharsPerToken()).toBe(2.3);
    expect(getOutputTokensPerInputLine()).toBe(DEFAULT_OUTPUT_TOKENS_PER_LINE);
  });

  it('fall back when the cached value is 0 (would divide by zero in estimateTokens)', () => {
    useSettingsStore.setState({
      llmProvider: 'ollama',
      llmModel: 'qwen3-4b',
      calibrationByModel: {
        [calibrationKey('ollama', 'qwen3-4b')!]: { inputCharsPerToken: 0, outputTokensPerInputLine: 0 },
      },
    });
    expect(getInputCharsPerToken()).toBe(2.3);
    expect(getOutputTokensPerInputLine()).toBe(DEFAULT_OUTPUT_TOKENS_PER_LINE);
  });

  it('fall back when the cached value is non-positive or non-finite (NaN, negative)', () => {
    useSettingsStore.setState({
      llmProvider: 'ollama',
      llmModel: 'qwen3-4b',
      calibrationByModel: {
        [calibrationKey('ollama', 'qwen3-4b')!]: { inputCharsPerToken: NaN, outputTokensPerInputLine: -5 },
      },
    });
    expect(getInputCharsPerToken()).toBe(2.3);
    expect(getOutputTokensPerInputLine()).toBe(DEFAULT_OUTPUT_TOKENS_PER_LINE);
  });
});
