import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Exercise the on-wire schema path (disabled by the ENFORCE_JSON_SCHEMA_ON_WIRE
// kill-switch by default). Force it on so the schema-sending code stays covered.
vi.mock('@/lib/llm/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/types')>();
  return { ...actual, ENFORCE_JSON_SCHEMA_ON_WIRE: true };
});

import { createOpenAIAdapter } from '@/lib/llm/openaiAdapter';
import { isLLMError } from '@/lib/llm/types';
import type { AdapterOptions, JSONSchema } from '@/lib/llm/types';

const SAMPLE_SCHEMA: JSONSchema = {
  type: 'object',
  properties: { type: { type: 'string', enum: ['bank', 'credit_card'] } },
  required: ['type'],
  additionalProperties: true,
};

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
    responseFormat: 'text',
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

      const opts = defaultOptions({ temperature: 0, maxOutputTokens: 2048 });
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

    it('emits response_format json_schema envelope with strict:false when json', async () => {
      mockFetch.mockResolvedValue(okResponse({
        choices: [{ message: { content: '{}' } }],
      }));

      await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions({
        responseFormat: 'json',
        responseSchema: SAMPLE_SCHEMA,
        schemaName: 'statement_type',
      }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.response_format).toEqual({
        type: 'json_schema',
        json_schema: { name: 'statement_type', strict: false, schema: SAMPLE_SCHEMA },
      });
    });

    it('never emits json_object on the wire', async () => {
      mockFetch.mockResolvedValue(okResponse({
        choices: [{ message: { content: '{}' } }],
      }));

      await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions({
        responseFormat: 'json',
        responseSchema: SAMPLE_SCHEMA,
        schemaName: 'x',
      }));

      const serialized = String(mockFetch.mock.calls[0][1].body);
      expect(serialized).not.toContain('json_object');
    });

    it('throws when json mode has no responseSchema', async () => {
      await expect(
        adapter.generate(BASE, 'llama3', 'prompt', defaultOptions({
          responseFormat: 'json',
          schemaName: 'x',
        })),
      ).rejects.toThrow('responseSchema');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when json mode has no schemaName', async () => {
      await expect(
        adapter.generate(BASE, 'llama3', 'prompt', defaultOptions({
          responseFormat: 'json',
          responseSchema: SAMPLE_SCHEMA,
        })),
      ).rejects.toThrow('schemaName');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when text mode carries a responseSchema', async () => {
      await expect(
        adapter.generate(BASE, 'llama3', 'prompt', defaultOptions({
          responseFormat: 'text',
          responseSchema: SAMPLE_SCHEMA,
        })),
      ).rejects.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('omits response_format when responseFormat is text', async () => {
      mockFetch.mockResolvedValue(okResponse({
        choices: [{ message: { content: 'ok' } }],
      }));

      await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions({ responseFormat: 'text' }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.response_format).toBeUndefined();
    });

    it('omits max_tokens when not provided', async () => {
      mockFetch.mockResolvedValue(okResponse({
        choices: [{ message: { content: 'result' } }],
      }));

      await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_tokens).toBeUndefined();
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

    it('throws LLMError with kind server-error on a 500', async () => {
      mockFetch.mockResolvedValue(errorResponse(500, 'Internal Server Error'));

      try {
        await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions());
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect(isLLMError(e) && e.kind).toBe('server-error');
        expect(isLLMError(e) && e.retryable).toBe(true);
      }
    });

    it('throws LLMError with kind model-missing on a 404', async () => {
      mockFetch.mockResolvedValue(errorResponse(404, 'model not found: llama3'));

      try {
        await adapter.generate(BASE, 'llama3', 'prompt', defaultOptions());
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(isLLMError(e) && e.kind).toBe('model-missing');
        expect(isLLMError(e) && e.retryable).toBe(false);
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
        expect(isLLMError(e) && e.kind).toBe('server-error');
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

    it('populates usage when the final data chunk carries usage', async () => {
      const sseData = [
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":""}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValue(sseResponse(sseData));

      const chunks: { usage?: { promptTokens: number; completionTokens: number } }[] = [];
      for await (const chunk of adapter.chatStream(BASE, 'llama3', [], defaultOptions())) {
        chunks.push({ usage: chunk.usage });
      }

      // Usage appears on the data chunk that carries it and on the terminal chunk.
      expect(chunks[chunks.length - 1].usage).toEqual({ promptTokens: 10, completionTokens: 5 });
    });

    it('emits a synthetic terminal chunk when the stream ends without [DONE]', async () => {
      // No [DONE] line — e.g. a mid-stream disconnect on an OpenAI-compatible server.
      // A terminal done:true chunk must still be emitted (spec §8, bug 10).
      const sseData = ['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'];
      mockFetch.mockResolvedValue(sseResponse(sseData));

      const doneFlags: boolean[] = [];
      for await (const chunk of adapter.chatStream(BASE, 'llama3', [], defaultOptions())) {
        doneFlags.push(chunk.done);
      }

      expect(doneFlags[doneFlags.length - 1]).toBe(true);
    });

    it('throws on non-OK response', async () => {
      mockFetch.mockResolvedValue(errorResponse(500, 'Server Error'));

      const stream = adapter.chatStream(BASE, 'llama3', [], defaultOptions());
      await expect(() => stream[Symbol.asyncIterator]().next()).rejects.toThrow();
    });

    it('attaches a retryable kind to chatStream error', async () => {
      mockFetch.mockResolvedValue(errorResponse(503, 'Service Unavailable'));

      try {
        const stream = adapter.chatStream(BASE, 'llama3', [], defaultOptions());
        await stream[Symbol.asyncIterator]().next();
        expect.fail('should have thrown');
      } catch (err) {
        expect(isLLMError(err) && err.kind).toBe('server-error');
        expect(isLLMError(err) && err.retryable).toBe(true);
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
        expect(isLLMError(e) && e.kind).toBe('server-error');
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
    it('parses model IDs from native LM Studio API with context_length', async () => {
      mockFetch.mockResolvedValue(okResponse({
        models: [
          { key: 'llama3', loaded_instances: [{ config: { context_length: 8192 } }] },
          { key: 'mistral', loaded_instances: [{ config: { context_length: 4096 } }] },
        ],
      }));

      const models = await adapter.listModels(BASE, new AbortController().signal);
      expect(models).toEqual([
        { id: 'llama3', contextLength: 8192 },
        { id: 'mistral', contextLength: 4096 },
      ]);
    });

    it('handles missing loaded_instances in native response', async () => {
      mockFetch.mockResolvedValue(okResponse({
        models: [{ key: 'llama3' }],
      }));

      const models = await adapter.listModels(BASE, new AbortController().signal);
      expect(models).toEqual([{ id: 'llama3', contextLength: undefined }]);
    });

    it('returns empty on non-OK response from both endpoints', async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(500, 'Error'))
        .mockResolvedValueOnce(errorResponse(500, 'Error'));

      const models = await adapter.listModels(BASE, new AbortController().signal);
      expect(models).toEqual([]);
    });

    it('returns empty on network error from both endpoints', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const models = await adapter.listModels(BASE, new AbortController().signal);
      expect(models).toEqual([]);
    });

    it('falls back to OpenAI-compatible /v1/models when native API returns empty', async () => {
      // Native LM Studio API returns empty models array
      mockFetch
        .mockResolvedValueOnce(okResponse({ models: [] }))
        // OpenAI-compatible endpoint returns models
        .mockResolvedValueOnce(okResponse({
          data: [
            { id: 'model-a', loaded_instances: [{ config: { context_length: 4096 } }] },
            { id: 'model-b' },
          ],
        }));

      const models = await adapter.listModels(BASE, new AbortController().signal);
      expect(models).toEqual([
        { id: 'model-a', contextLength: 4096 },
        { id: 'model-b', contextLength: undefined },
      ]);
    });

    it('falls back to /v1/models when native API throws', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('native API down'))
        .mockResolvedValueOnce(okResponse({
          data: [{ id: 'fallback-model' }],
        }));

      const models = await adapter.listModels(BASE, new AbortController().signal);
      expect(models).toEqual([{ id: 'fallback-model', contextLength: undefined }]);
    });

    it('returns empty when both native and fallback endpoints return non-OK', async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(500, 'native error'))
        .mockResolvedValueOnce(errorResponse(503, 'fallback error'));

      const models = await adapter.listModels(BASE, new AbortController().signal);
      expect(models).toEqual([]);
    });
  });

  // ── checkStatus ────────────────────────────────────────────────────────

  describe('checkStatus', () => {
    it('returns connected with models from native API', async () => {
      // Connectivity check, then listModels (native endpoint succeeds)
      mockFetch
        .mockResolvedValueOnce(okResponse({})) // connectivity check
        .mockResolvedValueOnce(okResponse({
          models: [
            { key: 'llama3', loaded_instances: [{ config: { context_length: 8192 } }] },
            { key: 'mistral' },
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
      // All fetches return empty data — native has no models, fallback also empty
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
