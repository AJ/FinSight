import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch — the only external boundary (LLM HTTP calls go through here)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);


import { runWithRetry, type ValidationResult } from '@/lib/parsers/retryEngine';

function lmStudioResponse(content: string) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }),
    text: () => Promise.resolve(JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    })),
  });
}

describe('runWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('succeeds on first attempt', async () => {
    mockFetch.mockResolvedValue(lmStudioResponse('{"key": "value"}'));
    const validateFn = vi.fn().mockReturnValue({
      valid: true, errors: [], warnings: [], data: { key: 'value' },
    } as ValidationResult<{ key: string }>);

    const result = await runWithRetry(
      '{RAW_TEXT}',
      'text',
      validateFn,
      { maxRetries: 3, stage: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.data).toEqual({ key: 'value' });
  });

  it('succeeds on retry after JSON parse failure', async () => {
    mockFetch
      .mockResolvedValueOnce(lmStudioResponse('not json'))
      .mockResolvedValueOnce(lmStudioResponse('{"key": "value"}'));

    const validateFn = vi.fn().mockReturnValue({
      valid: true, errors: [], warnings: [], data: { key: 'value' },
    } as ValidationResult<{ key: string }>);

    const result = await runWithRetry(
      '{RAW_TEXT}',
      'text',
      validateFn,
      { maxRetries: 3, stage: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('includes validation errors in retry prompt', async () => {
    mockFetch
      .mockResolvedValueOnce(lmStudioResponse('{"amount": "string"}'))
      .mockResolvedValueOnce(lmStudioResponse('{"amount": 123}'));

    const validateFn = vi.fn()
      .mockReturnValueOnce({
        valid: false,
        errors: ['amount is not a valid number'],
        warnings: [],
        data: null,
      } as ValidationResult<never>)
      .mockReturnValueOnce({
        valid: true,
        errors: [],
        warnings: [],
        data: { amount: 123 },
      } as ValidationResult<{ amount: number }>);

    const result = await runWithRetry(
      '{RAW_TEXT}',
      'text',
      validateFn,
      { maxRetries: 3, stage: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    // Second fetch call's body should contain validation errors in the prompt
    const secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    const secondCallPrompt = secondCallBody.messages[0].content;
    expect(secondCallPrompt).toContain('VALIDATION ERRORS TO FIX');
    expect(secondCallPrompt).toContain('amount is not a valid number');
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('returns failure after all retries exhausted', async () => {
    mockFetch.mockResolvedValue(lmStudioResponse('not json'));

    const validateFn = vi.fn().mockReturnValue({
      valid: true, errors: [], warnings: [], data: { key: 'value' },
    } as ValidationResult<{ key: string }>);

    const result = await runWithRetry(
      '{RAW_TEXT}',
      'text',
      validateFn,
      { maxRetries: 3, stage: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns failure with validation errors after max retries', async () => {
    mockFetch.mockResolvedValue(lmStudioResponse('{"amount": "string"}'));

    const validateFn = vi.fn().mockReturnValue({
      valid: false,
      errors: ['amount is not a valid number'],
      warnings: [],
      data: null,
    } as ValidationResult<never>);

    const result = await runWithRetry(
      '{RAW_TEXT}',
      'text',
      validateFn,
      { maxRetries: 3, stage: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.errors).toContain('amount is not a valid number');
  });
});
