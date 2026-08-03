import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch — the only external boundary (LLM HTTP calls go through here)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);


import { detectStatementType, ManualTypeSelectionError } from '@/lib/parsers/typeDetection';
import type { LLMRuntimeConfig } from '@/lib/llm/types';

const baseConfig: LLMRuntimeConfig = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  model: 'llama3',
};

function ollamaResponse(response: string) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      response,
      prompt_eval_count: 10,
      eval_count: 20,
    }),
    text: () => Promise.resolve(JSON.stringify({ response })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('detectStatementType', () => {
  it('detects bank statement', async () => {
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify({
      type: 'bank',
      confidence: 0.95,
      reason: 'Has opening/closing balance',
      bankName: 'HDFC',
    })));

    const result = await detectStatementType('some text', baseConfig);

    expect(result.statementType).toBe('bank');
    expect(result.confidence).toBe(0.95);
    expect(result.bankName).toBe('HDFC');
  });

  it('detects credit card statement', async () => {
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify({
      type: 'credit_card',
      confidence: 0.9,
      reason: 'Has credit limit and total due',
    })));

    const result = await detectStatementType('some text', baseConfig);

    expect(result.statementType).toBe('credit_card');
  });

  it.each(['cc', 'creditcard', 'credit_card_statement', 'card'])(
    'normalizes "%s" to credit_card',
    async (typeValue) => {
      mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify({ type: typeValue, confidence: 0.8 })));

      const result = await detectStatementType('text', baseConfig);

      expect(result.statementType).toBe('credit_card');
    },
  );

  it.each(['bank_statement', 'savings', 'current', 'checking'])(
    'normalizes "%s" to bank',
    async (typeValue) => {
      mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify({ type: typeValue, confidence: 0.8 })));

      const result = await detectStatementType('text', baseConfig);

      expect(result.statementType).toBe('bank');
    },
  );

  it('returns "unknown" instead of throwing when the model is uncertain', async () => {
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify({
      type: 'unknown',
      confidence: 0.3,
      reason: 'mixed signals',
    })));

    const result = await detectStatementType('text', baseConfig);

    // 'unknown' is a legitimate model outcome. detectStatementType must NOT throw
    // here — it returns the result so the pipeline can gate on it and convert the
    // low-confidence/unknown case into a ManualTypeSelectionError for the UI.
    expect(result.statementType).toBe('unknown');
    expect(result.confidence).toBe(0.3);
    expect(result.reason).toBe('mixed signals');
  });

  it('throws ManualTypeSelectionError on a malformed LLM response', async () => {
    mockFetch.mockResolvedValue(ollamaResponse('not json at all'));

    await expect(detectStatementType('text', baseConfig))
      .rejects.toBeInstanceOf(ManualTypeSelectionError);
  });

  it('normalizes bankName "unknown" to null', async () => {
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify({
      type: 'bank',
      confidence: 0.9,
      bankName: 'unknown',
    })));

    const result = await detectStatementType('text', baseConfig);

    expect(result.bankName).toBeNull();
  });

  it('preserves real bankName', async () => {
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify({
      type: 'bank',
      confidence: 0.9,
      bankName: 'ICICI',
    })));

    const result = await detectStatementType('text', baseConfig);

    expect(result.bankName).toBe('ICICI');
  });

  it('truncates long text before sending to LLM', async () => {
    const longText = 'x'.repeat(1500);
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify({ type: 'bank', confidence: 0.9 })));

    await detectStatementType(longText, baseConfig);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.prompt).toContain('[document truncated for brevity]');
    expect(body.prompt).not.toContain(longText);
  });

  it('does not truncate short text', async () => {
    const shortText = 'short statement text';
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify({ type: 'bank', confidence: 0.9 })));

    await detectStatementType(shortText, baseConfig);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.prompt).toContain(shortText);
    expect(body.prompt).not.toContain('[document truncated');
  });

  it('defaults reason to empty string when missing from LLM response', async () => {
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify({
      type: 'bank',
      confidence: 0.9,
    })));

    const result = await detectStatementType('text', baseConfig);

    expect(result.reason).toBe('');
  });

  it('passes signal through to fetch', async () => {
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify({ type: 'bank', confidence: 0.9 })));
    const controller = new AbortController();

    await detectStatementType('text', baseConfig, controller.signal);

    const fetchOptions = mockFetch.mock.calls[0][1];
    expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });

  // ── Gap coverage ──────────────────────────────────────────────────────────────

  it('normalizes "credit card" (space) to credit_card', async () => {
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify({
      type: 'credit card',
      confidence: 0.85,
    })));

    const result = await detectStatementType('text', baseConfig);

    expect(result.statementType).toBe('credit_card');
  });

  it('normalizes "credit-card" (hyphen) to credit_card', async () => {
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify({
      type: 'credit-card',
      confidence: 0.85,
    })));

    const result = await detectStatementType('text', baseConfig);

    expect(result.statementType).toBe('credit_card');
  });

  it('returns "unknown" for null type from LLM response', async () => {
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify({
      type: null,
      confidence: 0.3,
    })));

    const result = await detectStatementType('text', baseConfig);

    expect(result.statementType).toBe('unknown');
  });

  it('returns "unknown" for undefined type from LLM response', async () => {
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify({
      type: undefined,
      confidence: 0.3,
    })));

    const result = await detectStatementType('text', baseConfig);

    expect(result.statementType).toBe('unknown');
  });

  it('normalizes bankName "Unknown" (capitalized) to null', async () => {
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify({
      type: 'bank',
      confidence: 0.9,
      bankName: 'Unknown',
    })));

    const result = await detectStatementType('text', baseConfig);

    expect(result.bankName).toBeNull();
  });

  it('treats a missing confidence as 0 so the threshold gate rejects it', async () => {
    // A missing confidence is the lowest-confidence case. Coerce it to 0 so the
    // pipeline's 0.8 gate rejects it; returning undefined would make `undefined < 0.8`
    // evaluate to false (NaN comparison) and silently bypass the gate.
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify({
      type: 'bank',
    })));

    const result = await detectStatementType('text', baseConfig);

    expect(result.confidence).toBe(0);
  });

  it.each([
    ['a string', 'high'],
    ['a number above 1', 5],
    ['a negative number', -0.5],
  ])('treats invalid confidence (%s) as 0', async (_label, badValue) => {
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify({
      type: 'bank',
      confidence: badValue,
    })));

    const result = await detectStatementType('text', baseConfig);

    expect(result.confidence).toBe(0);
  });

  // ── Context overflow guard ────────────────────────────────────────────────────

  it('throws before calling the LLM when the prompt exceeds the context window', async () => {
    // Tiny context window → calculateMaxOutputTokens returns the 0 overflow sentinel.
    // System prompt (~121) + input buffer (200) already exceed 100, so overflow is
    // guaranteed regardless of stage-prompt size. The guard must throw an actionable
    // error naming the stage and the context size — NOT pass maxTokens:0 through to
    // the LLM, which would produce an empty response and an opaque "Type detection
    // failed" error.
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify({ type: 'bank', confidence: 0.9 })));

    await expect(detectStatementType('some text', baseConfig, undefined, 100))
      .rejects.toThrow(/exceeds the model's context window \(100 tokens\)/);

    // No fetch should have been attempted — the guard bailed before generate().
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
