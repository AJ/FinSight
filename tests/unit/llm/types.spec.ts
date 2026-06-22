import { describe, it, expect } from 'vitest';
import {
  LLMError,
  PROVIDERS,
  isLLMError,
  RETRYABLE_KINDS,
  type LLMProvider,
  type FailureKind,
} from '@/lib/llm/types';

describe('LLMError', () => {
  it('sets name to LLMError', () => {
    const error = new LLMError('test', 'server-error');
    expect(error.name).toBe('LLMError');
  });

  it('preserves message', () => {
    const error = new LLMError('something failed', 'model-missing');
    expect(error.message).toBe('something failed');
  });

  it('carries a kind and derives retryable from it', () => {
    const network = new LLMError('boom', 'server-unreachable');
    expect(network.kind).toBe('server-unreachable');
    expect(network.retryable).toBe(true);

    const fatal = new LLMError('no model', 'model-missing');
    expect(fatal.kind).toBe('model-missing');
    expect(fatal.retryable).toBe(false);
  });

  it('retryable is true only for the transport kinds (server-unreachable, server-error, timeout)', () => {
    const retryableKinds: readonly FailureKind[] = ['server-unreachable', 'server-error', 'timeout'];
    for (const kind of retryableKinds) {
      expect(new LLMError('x', kind).retryable).toBe(true);
    }
    const fatalKinds: readonly FailureKind[] = [
      'model-missing',
      'model-too-small',
      'request-rejected',
      'input-too-large',
      'invalid-response',
      'wrong-answer',
      'cancelled',
      'unknown',
    ];
    for (const kind of fatalKinds) {
      expect(new LLMError('x', kind).retryable).toBe(false);
    }
  });

  it('RETRYABLE_KINDS exposes the retryable set', () => {
    expect(RETRYABLE_KINDS.has('server-error')).toBe(true);
    expect(RETRYABLE_KINDS.has('server-unreachable')).toBe(true);
    expect(RETRYABLE_KINDS.has('model-missing')).toBe(false);
  });

  it('is instanceof Error', () => {
    const error = new LLMError('test', 'unknown');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(LLMError);
  });
});

describe('isLLMError', () => {
  it('returns true for an LLMError', () => {
    expect(isLLMError(new LLMError('test', 'server-error'))).toBe(true);
  });

  it('returns false for a plain Error', () => {
    expect(isLLMError(new Error('test'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isLLMError('string')).toBe(false);
    expect(isLLMError(null)).toBe(false);
    expect(isLLMError(undefined)).toBe(false);
    expect(isLLMError(42)).toBe(false);
  });

  it('narrows type so kind is accessible', () => {
    const error: unknown = new LLMError('test', 'model-missing');
    if (isLLMError(error)) {
      expect(error.kind).toBe('model-missing');
    } else {
      expect.fail('should have narrowed');
    }
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
    const providerKeys = Object.keys(PROVIDERS) as LLMProvider[];
    for (const key of providerKeys) {
      expect(PROVIDERS[key]).toBeDefined();
      expect(typeof PROVIDERS[key].adapter).toBe('string');
      expect(typeof PROVIDERS[key].defaultUrl).toBe('string');
      expect(typeof PROVIDERS[key].name).toBe('string');
    }
  });
});
