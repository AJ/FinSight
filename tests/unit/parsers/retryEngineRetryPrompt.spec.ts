import { describe, it, expect } from 'vitest';
import { buildRetryPrompt } from '@/lib/parsers/retryEngine';
import { calculateMaxOutputTokens } from '@/lib/llm/contextWindow';

const SYSTEM = 'SYSTEM';

describe('buildRetryPrompt paste-back bounding', () => {
  it('passes the overflow guard even when previousOutput exceeds the window', () => {
    const contextWindow = 2000;
    const base = 'BASE PROMPT'; // small, fits on its own
    // previousOutput far larger than the window
    const previousOutput = '{' + '"x":"y",'.repeat(8000) + '"z":1}';
    const prompt = buildRetryPrompt(base, previousOutput, ['Invalid JSON'], 2, {
      contextWindowTokens: contextWindow,
      systemPrompt: SYSTEM,
    });
    // The whole retry prompt (system + prompt) must leave output room → guard returns > 0.
    const budget = calculateMaxOutputTokens(contextWindow, `${SYSTEM}\n\n${prompt}`);
    expect(budget).not.toBe(0);
    expect(budget).toBeGreaterThan(0);
    expect(prompt).toContain('truncated');
  });

  it('includes previousOutput whole when it fits', () => {
    const base = 'BASE';
    const previousOutput = '{"small":1}';
    const prompt = buildRetryPrompt(base, previousOutput, ['err'], 2, {
      contextWindowTokens: 100000,
      systemPrompt: SYSTEM,
    });
    expect(prompt).toContain('{"small":1}');
    expect(prompt).not.toContain('truncated');
  });

  it('omits previousOutput when the base prompt alone leaves too little room', () => {
    const contextWindow = 2000;
    // A base prompt so large it already consumes most of the window.
    const base = 'B'.repeat(5000);
    const prompt = buildRetryPrompt(base, 'irrelevant', ['err'], 2, {
      contextWindowTokens: contextWindow,
      systemPrompt: SYSTEM,
    });
    expect(prompt).not.toContain('irrelevant');
  });

  it('includes previousOutput whole when the context window is unknown (guard skipped)', () => {
    // When the window is unknown the budget is Infinity — no truncation, no omission, regardless
    // of how large previousOutput is. This is the fallback path used before calibration lands a
    // real context length.
    const base = 'BASE';
    const previousOutput = '{"a":1,"b":2,"c":3}';
    const prompt = buildRetryPrompt(base, previousOutput, ['err'], 2, {
      contextWindowTokens: undefined,
      systemPrompt: SYSTEM,
    });
    expect(prompt).toContain('{"a":1,"b":2,"c":3}');
    expect(prompt).not.toContain('truncated');
  });
});
