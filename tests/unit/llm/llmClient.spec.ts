import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/llm/ollamaClient', () => ({
  generate: vi.fn(),
}));

vi.mock('@/lib/llm/lmstudioClient', () => ({
  generate: vi.fn(),
}));

import { callLLM } from '@/lib/llm/llmClient';
import { generate as generateOllama } from '@/lib/llm/ollamaClient';
import { generate as generateLMStudio } from '@/lib/llm/lmstudioClient';
import type { LLMRuntimeConfig } from '@/lib/llm/types';

const mockOllama = vi.mocked(generateOllama);
const mockLMStudio = vi.mocked(generateLMStudio);

const baseRuntime: LLMRuntimeConfig = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  model: 'llama3',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('callLLM', () => {
  it('dispatches to Ollama provider', async () => {
    mockOllama.mockResolvedValue('response text');

    const result = await callLLM('test prompt', { runtime: baseRuntime });

    expect(result).toBe('response text');
    expect(mockOllama).toHaveBeenCalledWith(
      'http://localhost:11434',
      'llama3',
      'test prompt',
      expect.objectContaining({ temperature: 0, max_tokens: 4096 }),
    );
  });

  it('dispatches to LMStudio provider with max_tokens', async () => {
    mockLMStudio.mockResolvedValue('lm response');

    const result = await callLLM('test prompt', {
      runtime: { ...baseRuntime, provider: 'lmstudio', baseUrl: 'http://localhost:1234' },
    });

    expect(result).toBe('lm response');
    expect(mockLMStudio).toHaveBeenCalledWith(
      'http://localhost:1234',
      'llama3',
      'test prompt',
      expect.objectContaining({ temperature: 0, max_tokens: 4096 }),
    );
  });

  it('throws for unsupported provider', async () => {
    await expect(
      callLLM('prompt', { runtime: { ...baseRuntime, provider: 'openai' as any } }),
    ).rejects.toThrow('Unsupported LLM provider');
  });

  it('throws when config is incomplete', async () => {
    await expect(
      callLLM('prompt', { runtime: { provider: null as any, baseUrl: null as any, model: null as any } }),
    ).rejects.toThrow('LLM model not configured');
  });

  it('retries on transient network error', async () => {
    mockOllama
      .mockRejectedValueOnce(new Error('connection timed out'))
      .mockResolvedValueOnce('retry success');

    const result = await callLLM('prompt', { runtime: baseRuntime });

    expect(result).toBe('retry success');
    expect(mockOllama).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-retryable error', async () => {
    mockOllama.mockRejectedValueOnce(new Error('model not found'));

    await expect(callLLM('prompt', { runtime: baseRuntime })).rejects.toThrow('model not found');
    expect(mockOllama).toHaveBeenCalledTimes(1);
  });

  it('re-throws immediately when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    mockOllama.mockImplementation(() => {
      throw new DOMException('The operation was aborted', 'AbortError');
    });

    await expect(
      callLLM('prompt', { runtime: baseRuntime, signal: controller.signal }),
    ).rejects.toThrow('aborted');

    expect(mockOllama).toHaveBeenCalledTimes(1);
  });

  it('re-throws on AbortError name without retrying', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    mockOllama.mockRejectedValueOnce(abortError);

    await expect(callLLM('prompt', { runtime: baseRuntime })).rejects.toThrow('aborted');
    expect(mockOllama).toHaveBeenCalledTimes(1);
  });

  it('retries on "server error" message', async () => {
    mockOllama
      .mockRejectedValueOnce(new Error('server error'))
      .mockResolvedValueOnce('recovered');

    const result = await callLLM('prompt', { runtime: baseRuntime });

    expect(result).toBe('recovered');
    expect(mockOllama).toHaveBeenCalledTimes(2);
  });

  it('retries on "network" message', async () => {
    mockOllama
      .mockRejectedValueOnce(new Error('network failure'))
      .mockResolvedValueOnce('recovered');

    const result = await callLLM('prompt', { runtime: baseRuntime });

    expect(result).toBe('recovered');
    expect(mockOllama).toHaveBeenCalledTimes(2);
  });

  it('throws on empty response', async () => {
    mockOllama.mockResolvedValue('');

    await expect(callLLM('prompt', { runtime: baseRuntime })).rejects.toThrow('LLM returned empty response');
  });

  it('throws on whitespace-only response', async () => {
    mockOllama.mockResolvedValue('   ');

    await expect(callLLM('prompt', { runtime: baseRuntime })).rejects.toThrow('LLM returned empty response');
  });

  it('trims the response', async () => {
    mockOllama.mockResolvedValue('  response text  ');

    const result = await callLLM('prompt', { runtime: baseRuntime });

    expect(result).toBe('response text');
  });
});
