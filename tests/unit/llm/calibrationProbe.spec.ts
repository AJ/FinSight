import { describe, it, expect } from 'vitest';
import { deriveRatios, CALIBRATION_SAMPLE } from '@/lib/llm/calibrationProbe';

describe('deriveRatios', () => {
  it('derives both ratios from reported usage', () => {
    const prompt = 'instruction\n' + CALIBRATION_SAMPLE;
    const sampleLineCount = CALIBRATION_SAMPLE.split('\n').length;
    const ratios = deriveRatios(prompt, { promptTokens: 200, completionTokens: 3000 }, sampleLineCount);
    expect(ratios).not.toBeNull();
    expect(ratios!.inputCharsPerToken).toBeCloseTo(prompt.length / 200, 5);
    expect(ratios!.outputTokensPerInputLine).toBeCloseTo(3000 / sampleLineCount, 5);
  });

  it('returns null when usage is missing', () => {
    expect(deriveRatios('x', undefined, 10)).toBeNull();
  });

  it('returns null when prompt or completion tokens are zero (Ollama cached-prompt quirk)', () => {
    expect(deriveRatios('x', { promptTokens: 0, completionTokens: 100 }, 10)).toBeNull();
    expect(deriveRatios('x', { promptTokens: 100, completionTokens: 0 }, 10)).toBeNull();
  });

  it('returns null when token counts are negative (buggy server)', () => {
    expect(deriveRatios('x', { promptTokens: -5, completionTokens: 100 }, 10)).toBeNull();
    expect(deriveRatios('x', { promptTokens: 100, completionTokens: -1 }, 10)).toBeNull();
  });

  it('returns null when the sample has no lines', () => {
    expect(deriveRatios('x', { promptTokens: 100, completionTokens: 100 }, 0)).toBeNull();
  });

  it('CALIBRATION_SAMPLE has enough lines to average tokenizer noise', () => {
    expect(CALIBRATION_SAMPLE.split('\n').length).toBeGreaterThanOrEqual(30);
  });
});
