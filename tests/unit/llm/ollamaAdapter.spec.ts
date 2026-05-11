import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ollamaAdapter } from '@/lib/llm/ollamaAdapter';
import { isAdapterError } from '@/lib/llm/types';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function defaultOptions(overrides?: Record<string, unknown>) {
  return {
    temperature: 0,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function okResponse(body: unknown, streamBody?: ReadableStream<Uint8Array>): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    body: streamBody ?? null,
  } as Response;
}

function errorResponse(status: number, text: string): Response {
  return {
    ok: false,
    status,
    statusText: text,
    text: () => Promise.resolve(text),
    json: () => Promise.reject(new Error('not json')),
  } as Response;
}

/** Build a ReadableStream that yields NDJSON chunks. */
function ndjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const content = lines.join('\n') + '\n';
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(content));
      controller.close();
    },
  });
}

/**
 * Build a ReadableStream that yields chunks split across multiple reads.
 * Each string in `chunks` becomes a separate `controller.enqueue`.
 */
function splitChunkStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

// ── generate ─────────────────────────────────────────────────────────────────

describe('ollamaAdapter.generate', () => {
  const baseUrl = 'http://localhost:11434';
  const model = 'llama3';

  it('sends POST to /api/generate with correct body', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ response: '{"result":true}', prompt_eval_count: 10, eval_count: 5 }),
    );

    await ollamaAdapter.generate(baseUrl, model, 'test prompt', defaultOptions());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/generate`);
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body);
    expect(body).toEqual({
      model,
      prompt: 'test prompt',
      stream: false,
      format: 'json',
      keep_alive: '10m',
      options: {
        num_ctx: 8192,
        num_predict: 4096,
        temperature: 0,
      },
    });
  });

  it('maps maxTokens to num_predict', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ response: 'ok', prompt_eval_count: 1, eval_count: 1 }),
    );

    await ollamaAdapter.generate(baseUrl, model, 'prompt', {
      ...defaultOptions(),
      maxTokens: 2048,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.num_predict).toBe(2048);
  });

  it('defaults num_predict to 4096 when maxTokens absent', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ response: 'ok' }));

    await ollamaAdapter.generate(baseUrl, model, 'prompt', defaultOptions());

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.num_predict).toBe(4096);
  });

  it('uses num_ctx from options.extra, defaults to 8192', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ response: 'ok' }));

    await ollamaAdapter.generate(baseUrl, model, 'prompt', {
      ...defaultOptions(),
      extra: { num_ctx: 32768 },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.num_ctx).toBe(32768);
  });

  it('uses default num_ctx when extra has no num_ctx', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ response: 'ok' }));

    await ollamaAdapter.generate(baseUrl, model, 'prompt', {
      ...defaultOptions(),
      extra: {},
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.num_ctx).toBe(8192);
  });

  it('passes keep_alive from options.extra, defaults to 10m', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ response: 'ok' }));

    await ollamaAdapter.generate(baseUrl, model, 'prompt', {
      ...defaultOptions(),
      extra: { keep_alive: '30m' },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.keep_alive).toBe('30m');
  });

  it('returns usage when token fields present', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ response: 'result', prompt_eval_count: 42, eval_count: 7 }),
    );

    const result = await ollamaAdapter.generate(baseUrl, model, 'prompt', defaultOptions());

    expect(result.text).toBe('result');
    expect(result.usage).toEqual({ promptTokens: 42, completionTokens: 7 });
  });

  it('returns undefined usage when token fields absent', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ response: 'result' }));

    const result = await ollamaAdapter.generate(baseUrl, model, 'prompt', defaultOptions());

    expect(result.text).toBe('result');
    expect(result.usage).toBeUndefined();
  });

  it('returns empty string when response field missing', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}));

    const result = await ollamaAdapter.generate(baseUrl, model, 'prompt', defaultOptions());

    expect(result.text).toBe('');
  });

  it('throws with status property on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500, 'internal error'));

    try {
      await ollamaAdapter.generate(baseUrl, model, 'prompt', defaultOptions());
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(isAdapterError(err) && err.status).toBe(500);
      expect((err as Error).message).toContain('Ollama generate error');
      expect((err as Error).message).toContain('internal error');
    }
  });

  it('handles non-JSON error text by using statusText', async () => {
    const response: Response = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: () => Promise.reject(new Error('cannot read')),
    } as Response;
    mockFetch.mockResolvedValueOnce(response);

    try {
      await ollamaAdapter.generate(baseUrl, model, 'prompt', defaultOptions());
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('Not Found');
      expect(isAdapterError(err) && err.status).toBe(404);
    }
  });

  it('passes top_p from options.extra to generate body', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ response: 'ok' }));

    await ollamaAdapter.generate(baseUrl, model, 'prompt', {
      ...defaultOptions(),
      extra: { top_p: 0.9 },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.top_p).toBe(0.9);
  });
});

// ── chatStream ───────────────────────────────────────────────────────────────

describe('ollamaAdapter.chatStream', () => {
  const baseUrl = 'http://localhost:11434';
  const model = 'llama3';
  const messages = [{ role: 'user', content: 'hello' }];

  it('yields ChatChunks from NDJSON stream', async () => {
    const chunks: string[] = [];
    mockFetch.mockResolvedValueOnce(okResponse({}, ndjsonStream([
      JSON.stringify({ message: { content: 'Hello' }, done: false }),
      JSON.stringify({ message: { content: ' world' }, done: false }),
      JSON.stringify({ message: { content: '' }, done: true }),
    ])));

    for await (const chunk of ollamaAdapter.chatStream(baseUrl, model, messages, defaultOptions())) {
      chunks.push(chunk.delta);
    }

    expect(chunks).toEqual(['Hello', ' world', '']);
  });

  it('sends POST to /api/chat with stream:true', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}, ndjsonStream([
      JSON.stringify({ message: { content: '' }, done: true }),
    ])));

    // consume the stream
    for await (const chunk of ollamaAdapter.chatStream(baseUrl, model, messages, defaultOptions())) {
      void chunk;
    }

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/chat`);
    const body = JSON.parse(init.body);
    expect(body.stream).toBe(true);
    expect(body.model).toBe(model);
    expect(body.messages).toEqual(messages);
  });

  it('uses num_ctx from options.extra', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}, ndjsonStream([
      JSON.stringify({ message: { content: '' }, done: true }),
    ])));

    for await (const chunk of ollamaAdapter.chatStream(baseUrl, model, messages, {
      ...defaultOptions(),
      extra: { num_ctx: 16384 },
    })) {
      void chunk;
    }

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.num_ctx).toBe(16384);
  });

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500, 'server blew up'));

    const gen = ollamaAdapter.chatStream(baseUrl, model, messages, defaultOptions());
    await expect(gen[Symbol.asyncIterator]().next()).rejects.toThrow(
      'Ollama chat error: server blew up',
    );
  });

  it('attaches .status to chatStream error', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(503, 'unavailable'));

    try {
      const gen = ollamaAdapter.chatStream(baseUrl, model, messages, defaultOptions());
      await gen[Symbol.asyncIterator]().next();
      expect.fail('should have thrown');
    } catch (err) {
      expect(isAdapterError(err) && err.status).toBe(503);
    }
  });

  it('throws when body is null', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}));

    const gen = ollamaAdapter.chatStream(baseUrl, model, messages, defaultOptions());
    await expect(gen[Symbol.asyncIterator]().next()).rejects.toThrow(
      'No response body from Ollama',
    );
  });

  it('skips malformed JSON lines', async () => {
    const chunks: string[] = [];
    mockFetch.mockResolvedValueOnce(okResponse({}, ndjsonStream([
      'not-json-at-all',
      JSON.stringify({ message: { content: 'valid' }, done: false }),
      '{broken json',
      JSON.stringify({ message: { content: '' }, done: true }),
    ])));

    for await (const chunk of ollamaAdapter.chatStream(baseUrl, model, messages, defaultOptions())) {
      chunks.push(chunk.delta);
    }

    // malformed lines are silently skipped; only valid JSON yields
    expect(chunks).toEqual(['valid', '']);
  });

  it('handles JSON split across chunks', async () => {
    const chunks: string[] = [];
    const part1 = '{"message":{"content":"hel';
    const part2 = 'lo"},"done":false}\n{"message":{"content":""},"done":true}\n';
    mockFetch.mockResolvedValueOnce(okResponse({}, splitChunkStream([part1, part2])));

    for await (const chunk of ollamaAdapter.chatStream(baseUrl, model, messages, defaultOptions())) {
      chunks.push(chunk.delta);
    }

    expect(chunks).toEqual(['hello', '']);
  });

  it('yields done=true as the final chunk', async () => {
    const yielded: boolean[] = [];
    mockFetch.mockResolvedValueOnce(okResponse({}, ndjsonStream([
      JSON.stringify({ message: { content: 'hi' }, done: false }),
      JSON.stringify({ message: { content: '' }, done: true }),
    ])));

    for await (const chunk of ollamaAdapter.chatStream(baseUrl, model, messages, defaultOptions())) {
      yielded.push(chunk.done);
    }

    expect(yielded).toEqual([false, true]);
  });

  it('passes keep_alive from options.extra to chatStream body', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}, ndjsonStream([
      JSON.stringify({ message: { content: '' }, done: true }),
    ])));

    for await (const chunk of ollamaAdapter.chatStream(baseUrl, model, messages, {
      ...defaultOptions(),
      extra: { keep_alive: '5m' },
    })) {
      void chunk;
    }

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.keep_alive).toBe('5m');
  });

  it('passes top_p from options.extra to chatStream body', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}, ndjsonStream([
      JSON.stringify({ message: { content: '' }, done: true }),
    ])));

    for await (const chunk of ollamaAdapter.chatStream(baseUrl, model, messages, {
      ...defaultOptions(),
      extra: { top_p: 0.95 },
    })) {
      void chunk;
    }

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.top_p).toBe(0.95);
  });
});

// ── listModels ───────────────────────────────────────────────────────────────

describe('ollamaAdapter.listModels', () => {
  const baseUrl = 'http://localhost:11434';

  it('parses model names and enriches first 5 with context length', async () => {
    // /api/tags
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    mockFetch.mockResolvedValueOnce(
      okResponse({
        models: names.map((n) => ({ name: n })),
      }),
    );
    // /api/show for first 5 models (enriched with context length)
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(
        okResponse({ parameters: `num_ctx\t${(i + 1) * 1024}` }),
      );
    }

    const result = await ollamaAdapter.listModels(baseUrl, new AbortController().signal);

    expect(result).toHaveLength(7);
    // First 5 have contextLength
    for (let i = 0; i < 5; i++) {
      expect(result[i].id).toBe(names[i]);
      expect(result[i].contextLength).toBe((i + 1) * 1024);
    }
    // Remaining 2 do not
    expect(result[5]).toEqual({ id: 'f' });
    expect(result[6]).toEqual({ id: 'g' });
  });

  it('returns models without context length beyond first 5', async () => {
    const names = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
    mockFetch.mockResolvedValueOnce(
      okResponse({ models: names.map((n) => ({ name: n })) }),
    );
    // /api/show for first 5
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(okResponse({ parameters: '' }));
    }

    const result = await ollamaAdapter.listModels(baseUrl, new AbortController().signal);

    expect(result).toHaveLength(6);
    expect(result[5]).toEqual({ id: 'm6' });
    expect(result[5].contextLength).toBeUndefined();
  });

  it('returns empty on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(503, 'unavailable'));

    const result = await ollamaAdapter.listModels(baseUrl, new AbortController().signal);

    expect(result).toEqual([]);
  });

  it('returns empty on network error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await ollamaAdapter.listModels(baseUrl, new AbortController().signal);

    expect(result).toEqual([]);
  });

  it('handles /api/show failure gracefully', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ models: [{ name: 'model1' }] }),
    );
    // /api/show fails
    mockFetch.mockRejectedValueOnce(new Error('timeout'));

    const result = await ollamaAdapter.listModels(baseUrl, new AbortController().signal);

    expect(result).toEqual([{ id: 'model1', contextLength: undefined }]);
  });

  it('handles malformed /api/show response', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ models: [{ name: 'model1' }] }),
    );
    // /api/show returns non-standard structure
    mockFetch.mockResolvedValueOnce(
      okResponse({ totally_wrong: 'data' }),
    );

    const result = await ollamaAdapter.listModels(baseUrl, new AbortController().signal);

    expect(result).toEqual([{ id: 'model1', contextLength: undefined }]);
  });

  it('handles /api/show returning non-OK status gracefully', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ models: [{ name: 'model1' }] }),
    );
    // /api/show returns 404 — fetchModelContextLength should return undefined
    mockFetch.mockResolvedValueOnce(errorResponse(404, 'model not found'));

    const result = await ollamaAdapter.listModels(baseUrl, new AbortController().signal);

    expect(result).toEqual([{ id: 'model1', contextLength: undefined }]);
  });

  it('parses context_length from model_info when parameters absent', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ models: [{ name: 'qwen' }] }),
    );
    mockFetch.mockResolvedValueOnce(
      okResponse({
        model_info: {
          'qwen2.context_length': 32768,
          'qwen2.other_field': 'ignored',
        },
      }),
    );

    const result = await ollamaAdapter.listModels(baseUrl, new AbortController().signal);

    expect(result[0].contextLength).toBe(32768);
  });
});

// ── checkStatus ──────────────────────────────────────────────────────────────

describe('ollamaAdapter.checkStatus', () => {
  const baseUrl = 'http://localhost:11434';

  it('returns connected with models on success', async () => {
    // root fetch
    mockFetch.mockResolvedValueOnce(okResponse('Ollama is running'));
    // /api/tags
    mockFetch.mockResolvedValueOnce(okResponse({ models: [{ name: 'llama3' }] }));
    // /api/show for llama3
    mockFetch.mockResolvedValueOnce(
      okResponse({ parameters: 'num_ctx\t4096' }),
    );

    const result = await ollamaAdapter.checkStatus(baseUrl, new AbortController().signal);

    expect(result.connected).toBe(true);
    expect(result.models).toEqual([{ id: 'llama3', contextLength: 4096 }]);
    expect(result.selectedModel).toBe('llama3');
  });

  it('returns disconnected on failure', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await ollamaAdapter.checkStatus(baseUrl, new AbortController().signal);

    expect(result).toEqual({ connected: false, models: [], selectedModel: null });
  });

  it('returns disconnected on non-OK status', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(502, 'bad gateway'));

    const result = await ollamaAdapter.checkStatus(baseUrl, new AbortController().signal);

    expect(result).toEqual({ connected: false, models: [], selectedModel: null });
  });

  it('returns null selectedModel when no models', async () => {
    mockFetch.mockResolvedValueOnce(okResponse('ok'));
    mockFetch.mockResolvedValueOnce(okResponse({ models: [] }));

    const result = await ollamaAdapter.checkStatus(baseUrl, new AbortController().signal);

    expect(result.connected).toBe(true);
    expect(result.models).toEqual([]);
    expect(result.selectedModel).toBeNull();
  });
});
