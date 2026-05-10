import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMError } from '@/lib/llm/types';

// Mock fetch — the only external boundary (LLM HTTP calls go through here)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { createClient } from '@/lib/llm/client';
import { SYSTEM_PROMPT } from '@/lib/llm/prompts';

// ── Ollama response helpers ──────────────────────────────────────────────────

function ollamaGenerateResponse(text: string, usage?: { prompt_eval_count: number; eval_count: number }) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      response: text,
      ...(usage ?? {}),
    }),
    text: () => Promise.resolve(JSON.stringify({ response: text })),
  };
}

function ollamaErrorStatus(status: number, message: string) {
  return {
    ok: false,
    status,
    statusText: message,
    text: () => Promise.resolve(message),
    json: () => Promise.resolve({ error: message }),
  };
}

// ── OpenAI (LM Studio) response helpers ──────────────────────────────────────

function openaiGenerateResponse(text: string, usage?: { prompt_tokens: number; completion_tokens: number }) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      choices: [{ message: { content: text } }],
      usage: usage ?? undefined,
    }),
    text: () => Promise.resolve(JSON.stringify({
      choices: [{ message: { content: text } }],
      usage,
    })),
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── generate ──────────────────────────────────────────────────────────────────

describe('createClient.generate', () => {
  const client = createClient('ollama');

  it('prepends system prompt to user prompt', async () => {
    mockFetch.mockResolvedValue(ollamaGenerateResponse('response'));

    await client.generate('http://localhost:11434', 'llama3', 'user prompt');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.prompt).toBe(`${SYSTEM_PROMPT}\n\nuser prompt`);
  });

  it('defaults temperature to 0', async () => {
    mockFetch.mockResolvedValue(ollamaGenerateResponse('response'));

    await client.generate('http://localhost:11434', 'llama3', 'prompt');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.temperature).toBe(0);
  });

  it('passes caller temperature override', async () => {
    mockFetch.mockResolvedValue(ollamaGenerateResponse('response'));

    await client.generate('http://localhost:11434', 'llama3', 'prompt', { temperature: 0.5 });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.temperature).toBe(0.5);
  });

  it('defaults maxTokens to 4096', async () => {
    mockFetch.mockResolvedValue(ollamaGenerateResponse('response'));

    await client.generate('http://localhost:11434', 'llama3', 'prompt');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.num_predict).toBe(4096);
  });

  it('passes maxTokens from options', async () => {
    mockFetch.mockResolvedValue(ollamaGenerateResponse('response'));

    await client.generate('http://localhost:11434', 'llama3', 'prompt', { maxTokens: 8192 });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.num_predict).toBe(8192);
  });

  it('passes extra to adapter options', async () => {
    mockFetch.mockResolvedValue(ollamaGenerateResponse('response'));

    await client.generate('http://localhost:11434', 'llama3', 'prompt', { extra: { num_ctx: 32768 } });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.num_ctx).toBe(32768);
  });

  it('routes to ollama adapter for ollama provider', async () => {
    mockFetch.mockResolvedValue(ollamaGenerateResponse('response'));

    await client.generate('http://localhost:11434', 'llama3', 'prompt');

    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:11434/api/generate');
  });

  it('routes to openai adapter for lmstudio provider', async () => {
    const lmClient = createClient('lmstudio');
    mockFetch.mockResolvedValue(openaiGenerateResponse('response'));

    await lmClient.generate('http://localhost:1234', 'mistral', 'prompt');

    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:1234/v1/chat/completions');
  });

  it('trims the response', async () => {
    mockFetch.mockResolvedValue(ollamaGenerateResponse('  response text  '));

    const result = await client.generate('http://localhost:11434', 'llama3', 'prompt');

    expect(result).toBe('response text');
  });

  it('throws LLMError on empty response', async () => {
    mockFetch.mockResolvedValue(ollamaGenerateResponse(''));

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
    mockFetch.mockResolvedValue(ollamaGenerateResponse('   '));

    await expect(client.generate('http://localhost:11434', 'llama3', 'prompt')).rejects.toThrow('empty response');
  });

  it('retries once on retryable error (500)', async () => {
    mockFetch
      .mockResolvedValueOnce(ollamaErrorStatus(500, 'internal error'))
      .mockResolvedValueOnce(ollamaGenerateResponse('recovered'));

    const result = await client.generate('http://localhost:11434', 'llama3', 'prompt');

    expect(result).toBe('recovered');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-retryable error (404)', async () => {
    mockFetch.mockResolvedValue(ollamaErrorStatus(404, 'model not found'));

    await expect(client.generate('http://localhost:11434', 'llama3', 'prompt')).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry when external signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    // The adapter will try to fetch but the signal is already aborted,
    // causing fetch to reject with AbortError
    mockFetch.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

    await expect(
      client.generate('http://localhost:11434', 'llama3', 'prompt', { signal: controller.signal }),
    ).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('classifies network TypeError as retryable', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(ollamaGenerateResponse('recovered'));

    const result = await client.generate('http://localhost:11434', 'llama3', 'prompt');
    expect(result).toBe('recovered');
  });

  it('classifies 500 status as retryable', async () => {
    mockFetch
      .mockResolvedValueOnce(ollamaErrorStatus(500, 'server error'))
      .mockResolvedValueOnce(ollamaGenerateResponse('recovered'));

    const result = await client.generate('http://localhost:11434', 'llama3', 'prompt');
    expect(result).toBe('recovered');
  });

  it('classifies 404 status as non-retryable', async () => {
    mockFetch.mockResolvedValue(ollamaErrorStatus(404, 'model not found'));

    try {
      await client.generate('http://localhost:11434', 'llama3', 'prompt');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(LLMError);
      expect((e as LLMError).retryable).toBe(false);
    }
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns trimmed text with usage telemetry', async () => {
    mockFetch.mockResolvedValue(ollamaGenerateResponse('response text', {
      prompt_eval_count: 100,
      eval_count: 50,
    }));

    const result = await client.generate('http://localhost:11434', 'llama3', 'prompt', { stage: 'transactions' });

    expect(result).toBe('response text');
  });

  it('works without usage data', async () => {
    mockFetch.mockResolvedValue(ollamaGenerateResponse('response'));

    const result = await client.generate('http://localhost:11434', 'llama3', 'prompt');

    expect(result).toBe('response');
  });
});

// ── chatStream ────────────────────────────────────────────────────────────────

describe('createClient.chatStream', () => {
  const client = createClient('ollama');

  it('defaults temperature to 0.7', async () => {
    // Simulate Ollama streaming response: NDJSON with a single chunk
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ message: { content: 'hi' }, done: true }) + '\n'));
        controller.close();
      },
    });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    });

    for await (const chunk of client.chatStream('http://localhost:11434', 'llama3', [])) { void chunk; break; }

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.temperature).toBe(0.7);
  });

  it('passes caller temperature override', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ message: { content: '' }, done: true }) + '\n'));
        controller.close();
      },
    });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    });

    for await (const chunk of client.chatStream('http://localhost:11434', 'llama3', [], { temperature: 0.05 })) { void chunk; break; }

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.temperature).toBe(0.05);
  });

  it('yields chunks from the adapter', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ message: { content: 'Hello' }, done: false }) + '\n'));
        controller.enqueue(encoder.encode(JSON.stringify({ message: { content: ' world' }, done: true }) + '\n'));
        controller.close();
      },
    });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    });

    const chunks: string[] = [];
    for await (const chunk of client.chatStream('http://localhost:11434', 'llama3', [])) {
      chunks.push(chunk.delta);
    }

    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('passes extra options to adapter', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ message: { content: '' }, done: true }) + '\n'));
        controller.close();
      },
    });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    });

    for await (const chunk of client.chatStream('http://localhost:11434', 'llama3', [], {
      extra: { num_ctx: 16384 },
    })) { void chunk; break; }

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.num_ctx).toBe(16384);
  });

  it('does not prepend system prompt to messages', async () => {
    const messages = [{ role: 'user', content: 'hello' }];
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ message: { content: '' }, done: true }) + '\n'));
        controller.close();
      },
    });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    });

    for await (const chunk of client.chatStream('http://localhost:11434', 'llama3', messages)) { void chunk; break; }

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(body.messages).toHaveLength(1);
  });
});

// ── listModels / checkStatus ──────────────────────────────────────────────────

describe('createClient.listModels', () => {
  const client = createClient('ollama');

  it('delegates to adapter and returns models', async () => {
    // Ollama listModels: fetches /api/tags then /api/show for each model
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ models: [{ name: 'llama3' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ parameters: 'num_ctx 8192', model_info: {} }),
      });

    const models = await client.listModels('http://localhost:11434');

    expect(models).toEqual([{ id: 'llama3', contextLength: 8192 }]);
  });

  it('returns empty array on adapter error', async () => {
    mockFetch.mockRejectedValue(new Error('connection refused'));

    const models = await client.listModels('http://localhost:11434');

    expect(models).toEqual([]);
  });
});

describe('createClient.checkStatus', () => {
  const client = createClient('ollama');

  it('delegates to adapter and returns connected status', async () => {
    // checkStatus: fetches root URL, then calls listModels internally
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ models: [{ name: 'llama3' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ parameters: '', model_info: {} }),
      });

    const result = await client.checkStatus('http://localhost:11434');

    expect(result.connected).toBe(true);
    expect(result.selectedModel).toBe('llama3');
  });

  it('returns disconnected on adapter error', async () => {
    mockFetch.mockRejectedValue(new Error('unreachable'));

    const result = await client.checkStatus('http://localhost:11434');

    expect(result.connected).toBe(false);
    expect(result.models).toEqual([]);
  });
});

// ── Adversarial / edge case tests ────────────────────────────────────────────

describe('createClient edge cases', () => {
  const client = createClient('ollama');

  it('classifyError handles non-Error throws (string)', async () => {
    mockFetch.mockRejectedValueOnce('string error');

    try {
      await client.generate('http://localhost:11434', 'llama3', 'prompt');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(LLMError);
      expect((e as LLMError).retryable).toBe(false);
    }
  });

  it('classifyError handles null throws', async () => {
    mockFetch.mockRejectedValueOnce(null);

    await expect(
      client.generate('http://localhost:11434', 'llama3', 'prompt'),
    ).rejects.toThrow(LLMError);
  });

  it('retry does not fire when signal is already aborted before call', async () => {
    const controller = new AbortController();
    controller.abort();

    mockFetch.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

    await expect(
      client.generate('http://localhost:11434', 'llama3', 'prompt', { signal: controller.signal }),
    ).rejects.toThrow();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('classifyError handles 4xx (not 404) as non-retryable', async () => {
    mockFetch.mockResolvedValue(ollamaErrorStatus(400, 'bad request'));

    try {
      await client.generate('http://localhost:11434', 'llama3', 'prompt');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(LLMError);
      expect((e as LLMError).retryable).toBe(false);
    }
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('classifyError handles 429 as non-retryable', async () => {
    mockFetch.mockResolvedValue(ollamaErrorStatus(429, 'rate limited'));

    try {
      await client.generate('http://localhost:11434', 'llama3', 'prompt');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(LLMError);
      expect((e as LLMError).retryable).toBe(false);
    }
  });

  it('classifyError passes through existing LLMError without wrapping', async () => {
    // To get an LLMError through the adapter, we need the adapter to produce
    // a response that results in an empty string (which the client wraps in LLMError)
    // Then on retry, throw the LLMError. We'll use a different approach:
    // Force the adapter to throw a network error that the client wraps as retryable,
    // then on second attempt, produce an empty response (non-retryable LLMError).
    // Actually, we need to test that classifyError(identity) passes through LLMError.
    // The simplest way: first call throws TypeError (retryable), second call returns
    // empty string (produces LLMError with retryable=false).
    mockFetch
      .mockRejectedValueOnce(new TypeError('temporary'))
      .mockResolvedValueOnce(ollamaGenerateResponse(''));

    try {
      await client.generate('http://localhost:11434', 'llama3', 'prompt');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(LLMError);
      expect((e as LLMError).retryable).toBe(false);
      expect((e as LLMError).message).toContain('empty response');
    }
  });

  it('second retry failure throws the last error', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockRejectedValueOnce(new TypeError('connection refused again'));

    await expect(client.generate('http://localhost:11434', 'llama3', 'prompt')).rejects.toThrow('connection refused again');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('chatStream wraps adapter errors in LLMError', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('Internal Server Error'),
    });

    await expect(async () => {
      for await (const chunk of client.chatStream('http://localhost:11434', 'llama3', [])) { void chunk; }
    }).rejects.toThrow(LLMError);
  });

  it('generate creates an AbortSignal for timeout', async () => {
    mockFetch.mockResolvedValue(ollamaGenerateResponse('ok'));

    await client.generate('http://localhost:11434', 'llama3', 'prompt', { timeout: 5000 });

    // The adapter receives the signal via fetch options
    const fetchOptions = mockFetch.mock.calls[0][1];
    expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });
});
