import { describe, it, expect } from 'vitest';
import { LLMError, PROVIDERS, DEFAULT_URLS, createAdapterError, isAdapterError, type LLMProvider } from '@/lib/llm/types';

describe('LLMError', () => {
  it('sets name to LLMError', () => {
    const error = new LLMError('test', true);
    expect(error.name).toBe('LLMError');
  });

  it('preserves message', () => {
    const error = new LLMError('something failed', false);
    expect(error.message).toBe('something failed');
  });

  it('marks retryable errors', () => {
    const error = new LLMError('timeout', true);
    expect(error.retryable).toBe(true);
  });

  it('marks non-retryable errors', () => {
    const error = new LLMError('not found', false);
    expect(error.retryable).toBe(false);
  });

  it('is instanceof Error', () => {
    const error = new LLMError('test', true);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(LLMError);
  });
});

describe('PROVIDERS', () => {
  it('maps ollama to ollama adapter', () => {
    expect(PROVIDERS.ollama.adapter).toBe('ollama');
    expect(PROVIDERS.ollama.defaultUrl).toBe('http://localhost:11434');
    expect(PROVIDERS.ollama.name).toBe('Ollama');
  });

  it('maps lmstudio to openai adapter', () => {
    expect(PROVIDERS.lmstudio.adapter).toBe('openai');
    expect(PROVIDERS.lmstudio.defaultUrl).toBe('http://localhost:1234');
    expect(PROVIDERS.lmstudio.name).toBe('LM Studio');
  });

  it('covers all LLMProvider values', () => {
    const providerKeys = Object.keys(DEFAULT_URLS) as LLMProvider[];
    for (const key of providerKeys) {
      expect(PROVIDERS[key]).toBeDefined();
      expect(typeof PROVIDERS[key].adapter).toBe('string');
      expect(typeof PROVIDERS[key].defaultUrl).toBe('string');
      expect(typeof PROVIDERS[key].name).toBe('string');
    }
  });
});

describe('createAdapterError', () => {
  it('creates an error with status property', () => {
    const error = createAdapterError('not found', 404);
    expect(error.message).toBe('not found');
    expect(error.status).toBe(404);
    expect(error).toBeInstanceOf(Error);
  });

  it('sets different status codes', () => {
    const error = createAdapterError('server error', 500);
    expect(error.status).toBe(500);
  });
});

describe('isAdapterError', () => {
  it('returns true for createAdapterError output', () => {
    const error = createAdapterError('test', 500);
    expect(isAdapterError(error)).toBe(true);
  });

  it('returns true for Object.assign error with status', () => {
    const error = Object.assign(new Error('test'), { status: 503 });
    expect(isAdapterError(error)).toBe(true);
  });

  it('returns false for plain Error', () => {
    expect(isAdapterError(new Error('test'))).toBe(false);
  });

  it('returns false for LLMError', () => {
    expect(isAdapterError(new LLMError('test', true))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isAdapterError('string')).toBe(false);
    expect(isAdapterError(null)).toBe(false);
    expect(isAdapterError(undefined)).toBe(false);
    expect(isAdapterError(42)).toBe(false);
  });

  it('returns false when status is not a number', () => {
    const error = Object.assign(new Error('test'), { status: '500' });
    expect(isAdapterError(error)).toBe(false);
  });

  it('narrows type for status access', () => {
    const error: unknown = createAdapterError('test', 404);
    if (isAdapterError(error)) {
      expect(error.status).toBe(404);
    } else {
      expect.fail('should have narrowed');
    }
  });
});
