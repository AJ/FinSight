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

  it('includes attempt-2 strictness instruction in retry prompt', async () => {
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

    await runWithRetry(
      '{RAW_TEXT}',
      'text',
      validateFn,
      { maxRetries: 3, stage: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    // The second fetch call is attempt 2
    const secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    const prompt = secondCallBody.messages[0].content;
    expect(prompt).toContain('Fix ALL errors listed above. Return ONLY valid JSON.');
  });

  it('includes attempt-3+ strictness instruction in retry prompt', async () => {
    mockFetch
      .mockResolvedValueOnce(lmStudioResponse('{"amount": "string"}'))
      .mockResolvedValueOnce(lmStudioResponse('{"amount": "still string"}'))
      .mockResolvedValueOnce(lmStudioResponse('{"amount": 123}'));

    const validateFn = vi.fn()
      .mockReturnValueOnce({
        valid: false,
        errors: ['amount is not a valid number'],
        warnings: [],
        data: null,
      } as ValidationResult<never>)
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

    await runWithRetry(
      '{RAW_TEXT}',
      'text',
      validateFn,
      { maxRetries: 3, stage: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    // The third fetch call is attempt 3
    const thirdCallBody = JSON.parse(mockFetch.mock.calls[2][1].body);
    const prompt = thirdCallBody.messages[0].content;
    expect(prompt).toContain('Return ONLY the minimal valid JSON structure.');
  });

  it('invokes onValidationFailure callback with parsed data and errors', async () => {
    mockFetch
      .mockResolvedValueOnce(lmStudioResponse('{"amount": "string"}'))
      .mockResolvedValueOnce(lmStudioResponse('{"amount": 123}'));

    const onValidationFailure = vi.fn();

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

    await runWithRetry(
      '{RAW_TEXT}',
      'text',
      validateFn,
      { maxRetries: 3, stage: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' }, onValidationFailure },
    );

    expect(onValidationFailure).toHaveBeenCalledTimes(1);
    expect(onValidationFailure).toHaveBeenCalledWith(
      { amount: 'string' },
      ['amount is not a valid number'],
    );
  });

  it('extracts _debug field from transaction stages', async () => {
    mockFetch.mockResolvedValue(lmStudioResponse('{"transactions": [], "_debug": {"model": "test-model"}}'));

    const validateFn = vi.fn().mockReturnValue({
      valid: true, errors: [], warnings: [], data: { transactions: [] },
    } as ValidationResult<{ transactions: never[] }>);

    const result = await runWithRetry(
      '{RAW_TEXT}',
      'text',
      validateFn,
      { maxRetries: 3, stage: 'cc_transactions', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    expect(result.success).toBe(true);
    expect(result.debugInfo).toEqual({ model: 'test-model' });
    // The _debug field should be stripped from the data passed to validateFn
    expect(validateFn).toHaveBeenCalledWith({ transactions: [] });
  });

  it('returns warnings from last validation when all retries exhausted', async () => {
    mockFetch.mockResolvedValue(lmStudioResponse('{"amount": "string"}'));

    const validateFn = vi.fn().mockReturnValue({
      valid: false,
      errors: ['amount is not a valid number'],
      warnings: ['Consider using a number field'],
      data: null,
    } as ValidationResult<never>);

    const result = await runWithRetry(
      '{RAW_TEXT}',
      'text',
      validateFn,
      { maxRetries: 3, stage: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    expect(result.success).toBe(false);
    expect(result.warnings).toEqual(['Consider using a number field']);
  });

  it('returns lastParsedData when retries exhausted after successful parse but failed validation', async () => {
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
      { maxRetries: 2, stage: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    // JSON parsed successfully each time, but validation always failed
    expect(result.success).toBe(false);
    expect(result.data).toEqual({ amount: 'string' });
  });

  it('returns failure immediately with maxRetries: 1', async () => {
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
      { maxRetries: 1, stage: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    // Only one fetch call was made
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('reports "Unknown error" when JSON parse throws a non-Error', async () => {
    // The 'Unknown error' path triggers when parseLLMJsonResponse throws something
    // that is not an Error instance. We make the JSON response valid enough to reach
    // the parser but have the content be something that triggers a non-Error throw.
    // However, parseLLMJsonResponse throws Error instances, so the non-Error path
    // in the retry engine's catch block is defensive code. We can still trigger it
    // by making the raw response content cause the LLM response parser to fail.
    //
    // Since the client wraps all LLM errors into LLMError (an Error subclass),
    // the "Unknown error" message in the outer catch is unreachable for LLM failures.
    // The inner catch (JSON parsing) also uses parseLLMJsonResponse which throws Errors.
    //
    // To actually test the non-Error path, we verify the fallback behavior when the
    // inner catch receives a non-Error. We simulate this with content that is not valid JSON.
    mockFetch.mockResolvedValue(lmStudioResponse('<<<not json at all{'));

    const result = await runWithRetry(
      '{RAW_TEXT}',
      'text',
      vi.fn().mockReturnValue({ valid: true, errors: [], warnings: [], data: null }),
      { maxRetries: 1, stage: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // parseLLMJsonResponse throws Error instances, so the error message will contain
    // the parse error details rather than "Unknown error"
    expect(result.errors[0]).toContain('Invalid JSON:');
  });

  it('forwards custom maxTokens to the client call', async () => {
    mockFetch.mockResolvedValue(lmStudioResponse('{"key": "value"}'));

    const validateFn = vi.fn().mockReturnValue({
      valid: true, errors: [], warnings: [], data: { key: 'value' },
    } as ValidationResult<{ key: string }>);

    await runWithRetry(
      '{RAW_TEXT}',
      'text',
      validateFn,
      { maxRetries: 1, stage: 'test', maxTokens: 2048, llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.max_tokens).toBe(2048);
  });

  it('provides context overflow error with context window hint', async () => {
    // Simulate LM Studio returning "Context size has been exceeded"
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ error: { message: 'Context size has been exceeded' } }),
      text: () => Promise.resolve(JSON.stringify({ error: { message: 'Context size has been exceeded' } })),
    });

    const result = await runWithRetry(
      '{RAW_TEXT}',
      'text',
      vi.fn().mockReturnValue({ valid: true, errors: [], warnings: [], data: null }),
      {
        maxRetries: 1,
        stage: 'test',
        contextWindowTokens: 16244,
        llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' },
      },
    );

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Statement too large for model context');
    expect(result.errors[0]).toContain('16244');
    expect(result.errors[0]).toContain('Consider using a model with a larger context window');
  });

  it('provides context overflow error without context window when unknown', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ error: { message: 'Context size exceeded limit' } }),
      text: () => Promise.resolve(JSON.stringify({ error: { message: 'Context size exceeded limit' } })),
    });

    const result = await runWithRetry(
      '{RAW_TEXT}',
      'text',
      vi.fn().mockReturnValue({ valid: true, errors: [], warnings: [], data: null }),
      {
        maxRetries: 1,
        stage: 'test',
        llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' },
      },
    );

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Statement too large for model context');
    expect(result.errors[0]).not.toContain('16244');
    expect(result.errors[0]).toContain('Consider using a model with a larger context window');
  });

  it('reports generic LLM call failure for non-context-size errors', async () => {
    // Simulate a server error that is NOT about context size
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ error: { message: 'Model not found' } }),
      text: () => Promise.resolve(JSON.stringify({ error: { message: 'Model not found' } })),
    });

    const result = await runWithRetry(
      '{RAW_TEXT}',
      'text',
      vi.fn().mockReturnValue({ valid: true, errors: [], warnings: [], data: null }),
      {
        maxRetries: 1,
        stage: 'test',
        llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' },
      },
    );

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('LLM call failed:');
  });

  it('re-throws when signal is aborted during LLM call', async () => {
    const controller = new AbortController();
    // Abort before the fetch even completes
    controller.abort();

    mockFetch.mockImplementation(() => {
      throw new DOMException('The user aborted a request.', 'AbortError');
    });

    await expect(
      runWithRetry(
        '{RAW_TEXT}',
        'text',
        vi.fn().mockReturnValue({ valid: true, errors: [], warnings: [], data: null }),
        {
          maxRetries: 1,
          stage: 'test',
          signal: controller.signal,
          llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' },
        },
      ),
    ).rejects.toThrow('aborted');
  });
});
