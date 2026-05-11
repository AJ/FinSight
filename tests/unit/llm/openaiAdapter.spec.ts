import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOpenAIAdapter } from '@/lib/llm/openaiAdapter';
import { isAdapterError } from '@/lib/llm/types';
import type { AdapterOptions } from '@/lib/llm/types';

// ── Helpers ────────────────────────────────────────────────────────────────

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function errorResponse(status: number, body: string): Response {
  return new Response(body, { status, statusText: 'Error' });
}

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function defaultOptions(overrides?: Partial<AdapterOptions>): AdapterOptions {
  return {
    temperature: 0,
    signal: new AbortController().signal,
    ...overrides,
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('createOpenAIAdapter', () => {
  const adapter = createOpenAIAdapter({ providerName: 'LM Studio' });
  const BASE = 'http://localhost:1234';

  // ── generate ───────────────────────────────────────────────────────────

  describe('generate', () => {
    it('sends POST to /v1/chat/completions with correct body', async () => {
      mockFetch.mockResolvedValue(okResponse({
        choices: [{ message: { content: 'hello' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }));

      const opts = defaultOptions({ temperature: 0, maxTokens: 2048 });
      await adapter.generate(BASE, 'llama3', 'test prompt', opts);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE}/v1/chat/completions`);
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body).toEqual({
        model: 'llama3',
        messages: [{ role: 'user', content: 'test prompt' }],
        stream: false,
        temperature: 0,
        max_tokens: 2048,
      });
    });

    it('defaults max_tokens to 4096 when not provided', async () => {
      mockFetch.mockResolvedValue(okResponse({
        choices: [{ message: { content: 'result' } }],
      }));

      await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_tokens).toBe(4096);
    });

    it('returns usage when present', async () => {
      mockFetch.mockResolvedValue(okResponse({
        choices: [{ message: { content: 'result' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }));

      const result = await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions());
      expect(result.text).toBe('result');
      expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 50 });
    });

    it('returns undefined usage when absent', async () => {
      mockFetch.mockResolvedValue(okResponse({
        choices: [{ message: { content: 'result' } }],
      }));

      const result = await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions());
      expect(result.usage).toBeUndefined();
    });

    it('returns empty string when choices is empty', async () => {
      mockFetch.mockResolvedValue(okResponse({ choices: [] }));

      const result = await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions());
      expect(result.text).toBe('');
    });

    it('returns empty string when choices is undefined', async () => {
      mockFetch.mockResolvedValue(okResponse({}));

      const result = await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions());
      expect(result.text).toBe('');
    });

    it('throws with status on non-OK response', async () => {
      mockFetch.mockResolvedValue(errorResponse(500, 'Internal Server Error'));

      try {
        await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions());
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect(isAdapterError(e) && e.status).toBe(500);
      }
    });

    it('parses model loading errors with provider name', async () => {
      mockFetch.mockResolvedValue(errorResponse(400,
        JSON.stringify({ error: { message: 'failed to load model' } }),
      ));

      try {
        await adapter.generate(BASE, 'bad-model', 'prompt', defaultOptions());
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).message).toContain('LM Studio');
        expect((e as Error).message).toContain('Model failed to load');
      }
    });

    it('parses model not found errors', async () => {
      mockFetch.mockResolvedValue(errorResponse(404,
        JSON.stringify({ error: 'model not found: llama3' }),
      ));

      try {
        await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions());
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('Model failed to load');
      }
    });

    it('parses model unloaded errors', async () => {
      mockFetch.mockResolvedValue(errorResponse(400,
        JSON.stringify({ error: { message: 'model is unloaded' } }),
      ));

      try {
        await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions());
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('unloaded');
        expect((e as Error).message).toContain('LM Studio');
      }
    });

    it('handles flat error format { error: { message } }', async () => {
      mockFetch.mockResolvedValue(errorResponse(500,
        JSON.stringify({ error: { message: 'Server is broken' } }),
      ));

      try {
        await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions());
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as Error).message).toBe('LM Studio error: Server is broken');
      }
    });

    it('handles non-JSON error response', async () => {
      mockFetch.mockResolvedValue(errorResponse(502, 'Bad Gateway'));

      try {
        await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions());
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).message).toContain('LM Studio request failed');
      }
    });

    it('handles non-JSON error response with unloaded text', async () => {
      mockFetch.mockResolvedValue(errorResponse(500, 'model was unloaded unexpectedly'));

      try {
        await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions());
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('unloaded');
      }
    });

    it('handles non-JSON error response with failed to load text', async () => {
      mockFetch.mockResolvedValue(errorResponse(500, 'failed to load model'));

      try {
        await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions());
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('Model failed to load');
      }
    });

    it('handles error object without .message field', async () => {
      mockFetch.mockResolvedValue(errorResponse(400,
        JSON.stringify({ error: { code: 'rate_limit_exceeded' } }),
      ));

      try {
        await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions());
        expect.unreachable('should have thrown');
      } catch (e) {
        // Falls through to generic message since .message is undefined
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).message).toContain('LM Studio');
      }
    });

    it('uses statusText fallback when res.text() rejects in generate', async () => {
      const response = new Response(null, { status: 500, statusText: 'Internal Server Error' });
      // Override text() to reject, simulating body already consumed
      Object.defineProperty(response, 'text', { value: () => Promise.reject(new Error('body locked')) });
      mockFetch.mockResolvedValue(response);

      try {
        await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions());
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect(isAdapterError(e) && e.status).toBe(500);
        // parseProviderError receives the statusText as non-JSON, falls to generic message
        expect((e as Error).message).toContain('LM Studio request failed');
      }
    });

    it('passes signal through to fetch', async () => {
      const controller = new AbortController();
      controller.abort();
      const opts = defaultOptions({ signal: controller.signal });

      await expect(adapter.generate(BASE, 'llama3', 'prompt', opts)).rejects.toThrow();
    });
  });

  // ── chatStream ─────────────────────────────────────────────────────────

  describe('chatStream', () => {
    it('sends POST to /v1/chat/completions with stream:true', async () => {
      const sseData = [
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValue(sseResponse(sseData));

      const messages = [{ role: 'user', content: 'hello' }];
      const opts = defaultOptions({ temperature: 0.7 });
      const chunks: string[] = [];
      for await (const chunk of adapter.chatStream(BASE, 'llama3', messages, opts)) {
        if (chunk.delta) chunks.push(chunk.delta);
      }

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
      expect(body.temperature).toBe(0.7);
      expect(body.messages).toEqual(messages);
      expect(chunks).toEqual(['hi']);
    });

    it('yields ChatChunks from SSE stream', async () => {
      const sseData = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValue(sseResponse(sseData));

      const results: { delta: string; done: boolean }[] = [];
      for await (const chunk of adapter.chatStream(BASE, 'llama3', [], defaultOptions())) {
        results.push({ delta: chunk.delta, done: chunk.done });
      }

      expect(results).toEqual([
        { delta: 'Hello', done: false },
        { delta: ' world', done: false },
        { delta: '', done: true },
      ]);
    });

    it('throws on non-OK response', async () => {
      mockFetch.mockResolvedValue(errorResponse(500, 'Server Error'));

      const stream = adapter.chatStream(BASE, 'llama3', [], defaultOptions());
      await expect(() => stream[Symbol.asyncIterator]().next()).rejects.toThrow();
    });

    it('attaches .status to chatStream error', async () => {
      mockFetch.mockResolvedValue(errorResponse(503, 'Service Unavailable'));

      try {
        const stream = adapter.chatStream(BASE, 'llama3', [], defaultOptions());
        await stream[Symbol.asyncIterator]().next();
        expect.fail('should have thrown');
      } catch (err) {
        expect(isAdapterError(err) && err.status).toBe(503);
      }
    });

    it('uses statusText fallback when res.text() rejects in chatStream', async () => {
      const response = new Response(null, { status: 502, statusText: 'Bad Gateway' });
      Object.defineProperty(response, 'text', { value: () => Promise.reject(new Error('body locked')) });
      mockFetch.mockResolvedValue(response);

      try {
        const stream = adapter.chatStream(BASE, 'llama3', [], defaultOptions());
        await stream[Symbol.asyncIterator]().next();
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect(isAdapterError(e) && e.status).toBe(502);
      }
    });

    it('throws when body is null', async () => {
      mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

      const stream = adapter.chatStream(BASE, 'llama3', [], defaultOptions());
      await expect(() => stream[Symbol.asyncIterator]().next()).rejects.toThrow(
        'No response body from LM Studio',
      );
    });

    it('skips SSE lines without data: prefix', async () => {
      const sseData = [
        ': this is a comment\n',
        'event: ping\n',
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValue(sseResponse(sseData));

      const deltas: string[] = [];
      for await (const chunk of adapter.chatStream(BASE, 'llama3', [], defaultOptions())) {
        if (chunk.delta) deltas.push(chunk.delta);
      }

      expect(deltas).toEqual(['ok']);
    });

    it('skips malformed JSON in SSE data', async () => {
      const sseData = [
        'data: {broken json\n\n',
        'data: {"choices":[{"delta":{"content":"good"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValue(sseResponse(sseData));

      const deltas: string[] = [];
      for await (const chunk of adapter.chatStream(BASE, 'llama3', [], defaultOptions())) {
        if (chunk.delta) deltas.push(chunk.delta);
      }

      expect(deltas).toEqual(['good']);
    });
  });

  // ── listModels ─────────────────────────────────────────────────────────

  describe('listModels', () => {
    it('parses model IDs and extracts context length from loaded_instances', async () => {
      mockFetch.mockResolvedValue(okResponse({
        data: [
          { id: 'llama3', loaded_instances: [{ config: { context_length: 8192 } }] },
          { id: 'mistral', loaded_instances: [{ config: { context_length: 4096 } }] },
        ],
      }));

      const models = await adapter.listModels(BASE, new AbortController().signal);
      expect(models).toEqual([
        { id: 'llama3', contextLength: 8192 },
        { id: 'mistral', contextLength: 4096 },
      ]);
    });

    it('handles missing loaded_instances', async () => {
      mockFetch.mockResolvedValue(okResponse({
        data: [{ id: 'llama3' }],
      }));

      const models = await adapter.listModels(BASE, new AbortController().signal);
      expect(models).toEqual([{ id: 'llama3', contextLength: undefined }]);
    });

    it('returns empty on non-OK response', async () => {
      mockFetch.mockResolvedValue(errorResponse(500, 'Error'));

      const models = await adapter.listModels(BASE, new AbortController().signal);
      expect(models).toEqual([]);
    });

    it('returns empty on network error', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const models = await adapter.listModels(BASE, new AbortController().signal);
      expect(models).toEqual([]);
    });
  });

  // ── checkStatus ────────────────────────────────────────────────────────

  describe('checkStatus', () => {
    it('returns connected with models on success', async () => {
      mockFetch.mockResolvedValue(okResponse({
        data: [
          { id: 'llama3', loaded_instances: [{ config: { context_length: 8192 } }] },
          { id: 'mistral' },
        ],
      }));

      const result = await adapter.checkStatus(BASE, new AbortController().signal);
      expect(result.connected).toBe(true);
      expect(result.models).toEqual([
        { id: 'llama3', contextLength: 8192 },
        { id: 'mistral', contextLength: undefined },
      ]);
      expect(result.selectedModel).toBe('llama3');
    });

    it('returns null selectedModel when no models available', async () => {
      mockFetch.mockResolvedValue(okResponse({ data: [] }));

      const result = await adapter.checkStatus(BASE, new AbortController().signal);
      expect(result.connected).toBe(true);
      expect(result.selectedModel).toBeNull();
    });

    it('returns disconnected on non-OK response', async () => {
      mockFetch.mockResolvedValue(errorResponse(503, 'Unavailable'));

      const result = await adapter.checkStatus(BASE, new AbortController().signal);
      expect(result.connected).toBe(false);
      expect(result.models).toEqual([]);
      expect(result.selectedModel).toBeNull();
    });

    it('returns disconnected on network error', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await adapter.checkStatus(BASE, new AbortController().signal);
      expect(result.connected).toBe(false);
      expect(result.models).toEqual([]);
      expect(result.selectedModel).toBeNull();
    });
  });

  // ── custom provider name ───────────────────────────────────────────────

  describe('with custom provider name', () => {
    it('uses custom provider name in error messages', async () => {
      const vllmAdapter = createOpenAIAdapter({ providerName: 'vLLM' });
      mockFetch.mockResolvedValue(errorResponse(500, 'Internal Server Error'));

      try {
        await vllmAdapter.generate(BASE, 'model', 'prompt', defaultOptions());
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('vLLM');
        expect((e as Error).message).not.toContain('LM Studio');
      }
    });

    it('uses custom provider name in chatStream error messages', async () => {
      const llamaAdapter = createOpenAIAdapter({ providerName: 'llama.cpp' });
      mockFetch.mockResolvedValue(errorResponse(500, 'Server Error'));

      const stream = llamaAdapter.chatStream(BASE, 'model', [], defaultOptions());
      try {
        await stream[Symbol.asyncIterator]().next();
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('llama.cpp');
      }
    });
  });
});
