import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMError, createAdapterError } from '@/lib/llm/types';
import type { LLMAdapter, TokenUsage } from '@/lib/llm/types';

type GenerateFn = LLMAdapter['generate'];
type ChatStreamFn = LLMAdapter['chatStream'];
type ListModelsFn = LLMAdapter['listModels'];
type CheckStatusFn = LLMAdapter['checkStatus'];

const {
  mockOllamaAdapter,
  mockOpenAIAdapter,
} = vi.hoisted(() => {
  const createMockAdapter = (): LLMAdapter => ({
    generate: vi.fn<GenerateFn>(),
    chatStream: vi.fn<ChatStreamFn>(),
    listModels: vi.fn<ListModelsFn>(),
    checkStatus: vi.fn<CheckStatusFn>(),
  });
  return {
    mockOllamaAdapter: createMockAdapter(),
    mockOpenAIAdapter: createMockAdapter(),
  };
});

vi.mock('@/lib/llm/ollamaAdapter', () => ({
  ollamaAdapter: mockOllamaAdapter,
}));
vi.mock('@/lib/llm/openaiAdapter', () => ({
  createOpenAIAdapter: () => mockOpenAIAdapter,
}));

vi.mock('@/lib/utils/debug', () => ({
  debugLog: vi.fn(),
  debugWarn: vi.fn(),
}));

import { createClient } from '@/lib/llm/client';
import { SYSTEM_PROMPT } from '@/lib/llm/prompts';

const ollamaGenerate = vi.mocked(mockOllamaAdapter.generate);
const openaiGenerate = vi.mocked(mockOpenAIAdapter.generate);
const ollamaChatStream = vi.mocked(mockOllamaAdapter.chatStream);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── generate ─────────────────────────────────────────────────────────────────

describe('createClient.generate', () => {
  const client = createClient('ollama');

  it('prepends system prompt to user prompt', async () => {
    ollamaGenerate.mockResolvedValue({ text: 'response', usage: undefined });

    await client.generate('http://localhost:11434', 'llama3', 'user prompt');

    const passedPrompt = ollamaGenerate.mock.calls[0][2];
    expect(passedPrompt).toBe(`${SYSTEM_PROMPT}\n\nuser prompt`);
  });

  it('defaults temperature to 0', async () => {
    ollamaGenerate.mockResolvedValue({ text: 'response', usage: undefined });

    await client.generate('http://localhost:11434', 'llama3', 'prompt');

    const opts = ollamaGenerate.mock.calls[0][3];
    expect(opts.temperature).toBe(0);
  });

  it('passes caller temperature override', async () => {
    ollamaGenerate.mockResolvedValue({ text: 'response', usage: undefined });

    await client.generate('http://localhost:11434', 'llama3', 'prompt', { temperature: 0.5 });

    const opts = ollamaGenerate.mock.calls[0][3];
    expect(opts.temperature).toBe(0.5);
  });

  it('defaults maxTokens to 4096', async () => {
    ollamaGenerate.mockResolvedValue({ text: 'response', usage: undefined });

    await client.generate('http://localhost:11434', 'llama3', 'prompt');

    const opts = ollamaGenerate.mock.calls[0][3];
    expect(opts.maxTokens).toBe(4096);
  });

  it('passes maxTokens from options', async () => {
    ollamaGenerate.mockResolvedValue({ text: 'response', usage: undefined });

    await client.generate('http://localhost:11434', 'llama3', 'prompt', { maxTokens: 8192 });

    const opts = ollamaGenerate.mock.calls[0][3];
    expect(opts.maxTokens).toBe(8192);
  });

  it('passes extra to adapter options', async () => {
    ollamaGenerate.mockResolvedValue({ text: 'response', usage: undefined });

    await client.generate('http://localhost:11434', 'llama3', 'prompt', { extra: { num_ctx: 32768 } });

    const opts = ollamaGenerate.mock.calls[0][3];
    expect(opts.extra).toEqual({ num_ctx: 32768 });
  });

  it('routes to ollama adapter for ollama provider', async () => {
    ollamaGenerate.mockResolvedValue({ text: 'response', usage: undefined });

    await client.generate('http://localhost:11434', 'llama3', 'prompt');

    expect(ollamaGenerate).toHaveBeenCalled();
    expect(openaiGenerate).not.toHaveBeenCalled();
  });

  it('routes to openai adapter for lmstudio provider', async () => {
    const lmClient = createClient('lmstudio');
    openaiGenerate.mockResolvedValue({ text: 'response', usage: undefined });

    await lmClient.generate('http://localhost:1234', 'mistral', 'prompt');

    expect(openaiGenerate).toHaveBeenCalled();
    expect(ollamaGenerate).not.toHaveBeenCalled();
  });

  it('trims the response', async () => {
    ollamaGenerate.mockResolvedValue({ text: '  response text  ', usage: undefined });

    const result = await client.generate('http://localhost:11434', 'llama3', 'prompt');

    expect(result).toBe('response text');
  });

  it('throws LLMError on empty response', async () => {
    ollamaGenerate.mockResolvedValue({ text: '', usage: undefined });

    try {
      await client.generate('http://localhost:11434', 'llama3', 'prompt');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(LLMError);
      expect((e as LLMError).retryable).toBe(false);
      expect((e as LLMError).message).toContain('empty response');
    }
  });

  it('throws LLMError on whitespace-only response', async () => {
    ollamaGenerate.mockResolvedValue({ text: '   ', usage: undefined });

    await expect(client.generate('http://localhost:11434', 'llama3', 'prompt')).rejects.toThrow('empty response');
  });

  it('retries once on retryable error', async () => {
    const retryableError = createAdapterError('timeout', 500);
    ollamaGenerate
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValueOnce({ text: 'recovered', usage: undefined });

    const result = await client.generate('http://localhost:11434', 'llama3', 'prompt');

    expect(result).toBe('recovered');
    expect(ollamaGenerate).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-retryable error', async () => {
    const notFound = createAdapterError('not found', 404);
    ollamaGenerate.mockRejectedValueOnce(notFound);

    await expect(client.generate('http://localhost:11434', 'llama3', 'prompt')).rejects.toThrow();
    expect(ollamaGenerate).toHaveBeenCalledTimes(1);
  });

  it('does not retry when external signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    ollamaGenerate.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

    await expect(
      client.generate('http://localhost:11434', 'llama3', 'prompt', { signal: controller.signal }),
    ).rejects.toThrow();
    expect(ollamaGenerate).toHaveBeenCalledTimes(1);
  });

  it('classifies network TypeError as retryable', async () => {
    ollamaGenerate
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ text: 'recovered', usage: undefined });

    const result = await client.generate('http://localhost:11434', 'llama3', 'prompt');
    expect(result).toBe('recovered');
  });

  it('classifies 500 status as retryable', async () => {
    const serverError = createAdapterError('server error', 500);

    ollamaGenerate
      .mockRejectedValueOnce(serverError)
      .mockResolvedValueOnce({ text: 'recovered', usage: undefined });

    const result = await client.generate('http://localhost:11434', 'llama3', 'prompt');
    expect(result).toBe('recovered');
  });

  it('classifies 404 status as non-retryable', async () => {
    const notFoundError = createAdapterError('model not found', 404);

    ollamaGenerate.mockRejectedValueOnce(notFoundError);

    try {
      await client.generate('http://localhost:11434', 'llama3', 'prompt');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(LLMError);
      expect((e as LLMError).retryable).toBe(false);
    }
    expect(ollamaGenerate).toHaveBeenCalledTimes(1);
  });

  it('logs telemetry with token counts', async () => {
    const { debugLog } = await import('@/lib/utils/debug');
    const usage: TokenUsage = { promptTokens: 100, completionTokens: 50 };
    ollamaGenerate.mockResolvedValue({ text: 'response', usage });

    await client.generate('http://localhost:11434', 'llama3', 'prompt', { stage: 'transactions' });

    expect(debugLog).toHaveBeenCalledWith(
      expect.stringContaining('[Ollama transactions]'),
    );
    expect(debugLog).toHaveBeenCalledWith(
      expect.stringContaining('Tokens: 100 + 50 = 150'),
    );
  });

  it('does not log telemetry when usage is undefined', async () => {
    const { debugLog } = await import('@/lib/utils/debug');
    ollamaGenerate.mockResolvedValue({ text: 'response', usage: undefined });

    await client.generate('http://localhost:11434', 'llama3', 'prompt');

    expect(debugLog).not.toHaveBeenCalled();
  });
});

// ── chatStream ───────────────────────────────────────────────────────────────

describe('createClient.chatStream', () => {
  const client = createClient('ollama');

  it('defaults temperature to 0.7', async () => {
    async function* fakeStream() {
      yield { delta: 'hi', done: true, usage: undefined };
    }
    ollamaChatStream.mockImplementation(fakeStream);

    for await (const chunk of client.chatStream('http://localhost:11434', 'llama3', [])) { void chunk; break; }

    const opts = ollamaChatStream.mock.calls[0][3];
    expect(opts.temperature).toBe(0.7);
  });

  it('passes caller temperature override', async () => {
    async function* fakeStream() {
      yield { delta: 'hi', done: true, usage: undefined };
    }
    ollamaChatStream.mockImplementation(fakeStream);

    for await (const chunk of client.chatStream('http://localhost:11434', 'llama3', [], { temperature: 0.05 })) { void chunk; break; }

    const opts = ollamaChatStream.mock.calls[0][3];
    expect(opts.temperature).toBe(0.05);
  });

  it('yields chunks from the adapter', async () => {
    async function* fakeStream() {
      yield { delta: 'Hello', done: false, usage: undefined };
      yield { delta: ' world', done: true, usage: undefined };
    }
    ollamaChatStream.mockImplementation(fakeStream);

    const chunks: string[] = [];
    for await (const chunk of client.chatStream('http://localhost:11434', 'llama3', [])) {
      chunks.push(chunk.delta);
    }

    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('passes extra options to adapter', async () => {
    async function* fakeStream() {
      yield { delta: '', done: true, usage: undefined };
    }
    ollamaChatStream.mockImplementation(fakeStream);

    for await (const chunk of client.chatStream('http://localhost:11434', 'llama3', [], {
      extra: { num_ctx: 16384 },
    })) { void chunk; break; }

    const opts = ollamaChatStream.mock.calls[0][3];
    expect(opts.extra).toEqual({ num_ctx: 16384 });
  });

  it('does not prepend system prompt to messages', async () => {
    const messages = [{ role: 'user', content: 'hello' }];
    async function* fakeStream() {
      yield { delta: '', done: true, usage: undefined };
    }
    ollamaChatStream.mockImplementation(fakeStream);

    for await (const chunk of client.chatStream('http://localhost:11434', 'llama3', messages)) { void chunk; break; }

    const passedMessages = ollamaChatStream.mock.calls[0][2];
    expect(passedMessages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(passedMessages).toHaveLength(1);
  });
});

// ── listModels / checkStatus ─────────────────────────────────────────────────

describe('createClient.listModels', () => {
  const client = createClient('ollama');

  it('delegates to adapter', async () => {
    vi.mocked(mockOllamaAdapter.listModels).mockResolvedValue([
      { id: 'llama3', contextLength: 8192 },
    ]);

    const models = await client.listModels('http://localhost:11434');

    expect(models).toEqual([{ id: 'llama3', contextLength: 8192 }]);
  });

  it('propagates adapter errors without wrapping', async () => {
    const adapterError = createAdapterError('connection refused', 500);
    vi.mocked(mockOllamaAdapter.listModels).mockRejectedValue(adapterError);

    await expect(client.listModels('http://localhost:11434')).rejects.toBe(adapterError);
  });
});

describe('createClient.checkStatus', () => {
  const client = createClient('ollama');

  it('delegates to adapter', async () => {
    vi.mocked(mockOllamaAdapter.checkStatus).mockResolvedValue({
      connected: true,
      models: [{ id: 'llama3' }],
      selectedModel: 'llama3',
    });

    const result = await client.checkStatus('http://localhost:11434');

    expect(result.connected).toBe(true);
    expect(result.selectedModel).toBe('llama3');
  });

  it('propagates adapter errors without wrapping', async () => {
    const adapterError = createAdapterError('unreachable', 503);
    vi.mocked(mockOllamaAdapter.checkStatus).mockRejectedValue(adapterError);

    await expect(client.checkStatus('http://localhost:11434')).rejects.toBe(adapterError);
  });
});

// ── Adversarial / edge case tests ────────────────────────────────────────────

describe('createClient edge cases', () => {
  const client = createClient('ollama');

  it('classifyError handles non-Error throws (string)', async () => {
    ollamaGenerate.mockRejectedValueOnce('string error');

    try {
      await client.generate('http://localhost:11434', 'llama3', 'prompt');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(LLMError);
      expect((e as LLMError).retryable).toBe(false);
    }
  });

  it('classifyError handles null throws', async () => {
    ollamaGenerate.mockRejectedValueOnce(null);

    await expect(
      client.generate('http://localhost:11434', 'llama3', 'prompt'),
    ).rejects.toThrow(LLMError);
  });

  it('retry does not fire when signal is already aborted before call', async () => {
    const controller = new AbortController();
    controller.abort();

    ollamaGenerate.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

    await expect(
      client.generate('http://localhost:11434', 'llama3', 'prompt', { signal: controller.signal }),
    ).rejects.toThrow();

    expect(ollamaGenerate).toHaveBeenCalledTimes(1);
  });

  it('classifyError handles 4xx (not 404) as non-retryable', async () => {
    const error = createAdapterError('bad request', 400);

    ollamaGenerate.mockRejectedValueOnce(error);

    try {
      await client.generate('http://localhost:11434', 'llama3', 'prompt');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(LLMError);
      expect((e as LLMError).retryable).toBe(false);
    }
    expect(ollamaGenerate).toHaveBeenCalledTimes(1);
  });

  it('classifyError handles 429 as non-retryable (not 5xx)', async () => {
    const error = createAdapterError('rate limited', 429);

    ollamaGenerate.mockRejectedValueOnce(error);

    try {
      await client.generate('http://localhost:11434', 'llama3', 'prompt');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(LLMError);
      expect((e as LLMError).retryable).toBe(false);
    }
  });

  it('classifyError passes through existing LLMError without wrapping', async () => {
    const original = new LLMError('original', false);
    ollamaGenerate.mockRejectedValueOnce(original);

    await expect(client.generate('http://localhost:11434', 'llama3', 'prompt')).rejects.toBe(original);
  });

  it('second retry failure throws the last error', async () => {
    const error1 = new TypeError('connection refused');
    const error2 = new TypeError('connection refused again');
    ollamaGenerate
      .mockRejectedValueOnce(error1)
      .mockRejectedValueOnce(error2);

    await expect(client.generate('http://localhost:11434', 'llama3', 'prompt')).rejects.toThrow('connection refused again');
    expect(ollamaGenerate).toHaveBeenCalledTimes(2);
  });

  it('chatStream wraps adapter errors in LLMError', async () => {
    async function* failingStream() {
      throw new Error('stream broke');
    }
    ollamaChatStream.mockImplementation(failingStream);

    await expect(async () => {
      for await (const chunk of client.chatStream('http://localhost:11434', 'llama3', [])) { void chunk; }
    }).rejects.toThrow(LLMError);
  });

  it('generate passes timeout override to abort signal', async () => {
    ollamaGenerate.mockImplementation(async (_baseUrl, _model, _prompt, options) => {
      expect(options.signal).toBeInstanceOf(AbortSignal);
      return { text: 'ok', usage: undefined };
    });

    await client.generate('http://localhost:11434', 'llama3', 'prompt', { timeout: 5000 });
  });
});
