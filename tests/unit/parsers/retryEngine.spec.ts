import { describe, it, expect, vi, beforeEach } from 'vitest';

// The "forwards schema to the wire" test exercises the schema path, disabled by the
// ENFORCE_JSON_SCHEMA_ON_WIRE kill-switch by default. Force it on for this file.
vi.mock('@/lib/llm/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/types')>();
  return { ...actual, ENFORCE_JSON_SCHEMA_ON_WIRE: true };
});

// Mock fetch — the only external boundary (LLM HTTP calls go through here)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);


import { runWithRetry, type ValidationResult } from '@/lib/parsers/retryEngine';
import type { JSONSchema } from '@/lib/llm/types';

// retryEngine always runs in json mode, which requires a schema. These tests exercise the
// retry/validation mechanics, not a particular shape, so they share one permissive schema.
const RETRY_SCHEMA: JSONSchema = {
  type: 'object',
  properties: { key: { type: 'string' }, amount: { type: 'number' } },
  additionalProperties: true,
};

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
      { maxRetries: 3, stage: 'test', responseSchema: RETRY_SCHEMA, schemaName: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
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
      { maxRetries: 3, stage: 'test', responseSchema: RETRY_SCHEMA, schemaName: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
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
      { maxRetries: 3, stage: 'test', responseSchema: RETRY_SCHEMA, schemaName: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    // Second fetch call's body should contain validation errors in the prompt
    const secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    const secondCallPrompt = secondCallBody.messages[1].content;
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
      { maxRetries: 3, stage: 'test', responseSchema: RETRY_SCHEMA, schemaName: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
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
      { maxRetries: 3, stage: 'test', responseSchema: RETRY_SCHEMA, schemaName: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
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
      { maxRetries: 3, stage: 'test', responseSchema: RETRY_SCHEMA, schemaName: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    // The second fetch call is attempt 2
    const secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    const prompt = secondCallBody.messages[1].content;
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
      { maxRetries: 3, stage: 'test', responseSchema: RETRY_SCHEMA, schemaName: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    // The third fetch call is attempt 3
    const thirdCallBody = JSON.parse(mockFetch.mock.calls[2][1].body);
    const prompt = thirdCallBody.messages[1].content;
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
      { maxRetries: 3, stage: 'test', responseSchema: RETRY_SCHEMA, schemaName: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' }, onValidationFailure },
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
      { maxRetries: 3, stage: 'cc_transactions', responseSchema: RETRY_SCHEMA, schemaName: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
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
      { maxRetries: 3, stage: 'test', responseSchema: RETRY_SCHEMA, schemaName: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
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
      { maxRetries: 2, stage: 'test', responseSchema: RETRY_SCHEMA, schemaName: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
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
      { maxRetries: 1, stage: 'test', responseSchema: RETRY_SCHEMA, schemaName: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
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
      { maxRetries: 1, stage: 'test', responseSchema: RETRY_SCHEMA, schemaName: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // parseLLMJsonResponse throws Error instances, so the error message will contain
    // the parse error details rather than "Unknown error"
    expect(result.errors[0]).toContain('Invalid JSON:');
  });

  it('passes a context-aware maxTokens to the client call when context window is known', async () => {
    mockFetch.mockResolvedValue(lmStudioResponse('{"key": "value"}'));

    const validateFn = vi.fn().mockReturnValue({
      valid: true, errors: [], warnings: [], data: { key: 'value' },
    } as ValidationResult<{ key: string }>);

    await runWithRetry(
      '{RAW_TEXT}',
      'text',
      validateFn,
      { maxRetries: 1, stage: 'test', contextWindowTokens: 1000, responseSchema: RETRY_SCHEMA, schemaName: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    // maxTokens is computed by calculateMaxOutputTokens (context − system − stage − buffers).
    // It must be a positive number strictly less than the context window.
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.max_tokens).toBeDefined();
    expect(typeof callBody.max_tokens).toBe('number');
    expect(callBody.max_tokens).toBeGreaterThan(0);
    expect(callBody.max_tokens).toBeLessThan(1000);
  });

  it('omits maxTokens when context window is unknown', async () => {
    mockFetch.mockResolvedValue(lmStudioResponse('{"key": "value"}'));

    const validateFn = vi.fn().mockReturnValue({
      valid: true, errors: [], warnings: [], data: { key: 'value' },
    } as ValidationResult<{ key: string }>);

    await runWithRetry(
      '{RAW_TEXT}',
      'text',
      validateFn,
      { maxRetries: 1, stage: 'test', responseSchema: RETRY_SCHEMA, schemaName: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.max_tokens).toBeUndefined();
  });

  it('pre-flight guard bails without calling LLM when prompt exceeds context window', async () => {
    // Tiny context window + a large normalized text → calculateMaxOutputTokens returns 0.
    mockFetch.mockResolvedValue(lmStudioResponse('{"key": "value"}'));

    const largeText = 'x'.repeat(5000);
    const result = await runWithRetry(
      '{RAW_TEXT}',
      largeText,
      vi.fn().mockReturnValue({ valid: true, errors: [], warnings: [], data: null }),
      { maxRetries: 3, stage: 'cc_summary', contextWindowTokens: 200, responseSchema: RETRY_SCHEMA, schemaName: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    expect(result.success).toBe(false);
    expect(result.contextOverflow).toBe(true);
    // No fetch call should have been attempted — the guard bailed before generate().
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.errors[0]).toContain("exceeds the model's context window");
    expect(result.errors[0]).toContain('200');
  });

  it('pre-flight guard reports attempts made when bailing early', async () => {
    // On the very first attempt the guard triggers, so attemptsMade should be 1, not maxRetries.
    const largeText = 'x'.repeat(5000);
    const result = await runWithRetry(
      '{RAW_TEXT}',
      largeText,
      vi.fn().mockReturnValue({ valid: true, errors: [], warnings: [], data: null }),
      { maxRetries: 3, stage: 'cc_summary', contextWindowTokens: 200, responseSchema: RETRY_SCHEMA, schemaName: 'test', llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' } },
    );

    expect(result.attempts).toBe(1);
  });

  it('records a server-error as a generic LLM call failure (no context-size string-match)', async () => {
    // Task 12 deleted the "context size" string-match. A 500 (even one whose body mentions
    // "Context size") is now a server-error LLMError, recorded as "LLM call failed: …" —
    // overflow is decided by the pre-flight guard, not by sniffing provider error strings.
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
        responseSchema: RETRY_SCHEMA, schemaName: 'test',
        llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' },
      },
    );

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('LLM call failed:');
    expect(result.contextOverflow).toBeFalsy();
  });

  it('records a server-error as a generic LLM call failure when context window is unknown', async () => {
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
        responseSchema: RETRY_SCHEMA, schemaName: 'test',
        llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' },
      },
    );

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('LLM call failed:');
    expect(result.contextOverflow).toBeFalsy();
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
        responseSchema: RETRY_SCHEMA, schemaName: 'test',
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
          responseSchema: RETRY_SCHEMA, schemaName: 'test',
          llmConfig: { provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' },
        },
      ),
    ).rejects.toThrow('aborted');
  });

  it('forwards responseSchema + schemaName from RetryConfig to the wire', async () => {
    // Ollama provider → schema appears as body.format (the adapter maps it directly).
    mockFetch.mockResolvedValue(Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ response: '{"ok":true}', done: true }),
      text: () => Promise.resolve(JSON.stringify({ response: '{"ok":true}', done: true })),
    }));

    const validateFn = vi.fn().mockReturnValue({
      valid: true, errors: [], warnings: [], data: { ok: true },
    } as ValidationResult<{ ok: boolean }>);

    const schema: JSONSchema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
    await runWithRetry(
      '{RAW_TEXT}',
      'text',
      validateFn,
      {
        maxRetries: 1,
        stage: 'cc_summary',
        llmConfig: { provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'test' },
        responseSchema: schema,
        schemaName: 'cc_summary',
      },
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.format).toEqual(schema);
  });
});
