import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerate = vi.fn();

vi.mock('@/lib/llm/index', () => ({
  getClient: () => ({ generate: mockGenerate }),
}));

vi.mock('@/lib/utils/debug', () => ({
  debugLog: vi.fn(),
}));

import { runWithRetry, type ValidationResult } from '@/lib/parsers/retryEngine';

describe('runWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('succeeds on first attempt', async () => {
    mockGenerate.mockResolvedValueOnce('{"key": "value"}');
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
    mockGenerate
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce('{"key": "value"}');

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
    mockGenerate
      .mockResolvedValueOnce('{"amount": "string"}')
      .mockResolvedValueOnce('{"amount": 123}');

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

    // Second generate call should receive a prompt containing the validation error
    const secondCallPrompt = mockGenerate.mock.calls[1][2];
    expect(secondCallPrompt).toContain('VALIDATION ERRORS TO FIX');
    expect(secondCallPrompt).toContain('amount is not a valid number');
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('returns failure after all retries exhausted', async () => {
    mockGenerate.mockResolvedValue('not json');

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
    mockGenerate.mockResolvedValue('{"amount": "string"}');

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
