import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to mock callLLM since it makes network calls
vi.mock('@/lib/llm/llmClient', () => ({
  callLLM: vi.fn(),
}));

vi.mock('@/lib/utils/debug', () => ({
  debugLog: vi.fn(),
}));

// Need to import after mocking
import { runWithRetry, type ValidationResult } from '@/lib/parsers/retryEngine';
import { callLLM } from '@/lib/llm/llmClient';

const mockCallLLM = vi.mocked(callLLM);

describe('runWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('succeeds on first attempt', async () => {
    mockCallLLM.mockResolvedValueOnce('{"key": "value"}');
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
    // First call returns bad JSON, second returns good
    mockCallLLM
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
    // First call returns valid JSON but fails validation
    mockCallLLM
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

    // Second callLLM should receive a prompt containing the validation error
    const secondCallPrompt = mockCallLLM.mock.calls[1][0];
    expect(secondCallPrompt).toContain('VALIDATION ERRORS TO FIX');
    expect(secondCallPrompt).toContain('amount is not a valid number');
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('returns failure after all retries exhausted', async () => {
    // All calls return bad JSON
    mockCallLLM.mockResolvedValue('not json');

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
    // All calls return valid JSON but fail validation
    mockCallLLM.mockResolvedValue('{"amount": "string"}');

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
