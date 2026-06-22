import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// These tests exercise the on-wire schema path, which is currently disabled by the
// ENFORCE_JSON_SCHEMA_ON_WIRE kill-switch (text mode by default). Force it on here so the
// schema-sending code stays covered while the feature is dormant.
vi.mock('@/lib/llm/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/types')>();
  return { ...actual, ENFORCE_JSON_SCHEMA_ON_WIRE: true };
});

import { ollamaAdapter } from '@/lib/llm/ollamaAdapter';
import { isLLMError } from '@/lib/llm/types';
import type { JSONSchema } from '@/lib/llm/types';

const mockFetch = vi.fn();

const SAMPLE_SCHEMA: JSONSchema = {
  type: 'object',
  properties: { type: { type: 'string', enum: ['bank', 'credit_card'] } },
  required: ['type'],
  additionalProperties: true,
};

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
    responseFormat: 'text' as const,
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
    // No responseFormat/contextWindow passed → no format, no num_ctx.
    expect(body).toEqual({
      model,
      prompt: 'test prompt',
      stream: false,
      keep_alive: '10m',
      options: {
        temperature: 0,
      },
    });
  });

  it('emits format: <schema object> when responseFormat is json', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ response: 'ok' }));

    await ollamaAdapter.generate(baseUrl, model, 'prompt', {
      ...defaultOptions(),
      responseFormat: 'json',
      responseSchema: SAMPLE_SCHEMA,
      schemaName: 'statement_type',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.format).toEqual(SAMPLE_SCHEMA);
    expect(body.format).not.toBe('json');
  });

  it('omits format when responseFormat is text', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ response: 'ok' }));

    await ollamaAdapter.generate(baseUrl, model, 'prompt', {
      ...defaultOptions(),
      responseFormat: 'text',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.format).toBeUndefined();
  });

  it('maps maxOutputTokens to num_predict', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ response: 'ok', prompt_eval_count: 1, eval_count: 1 }),
    );

    await ollamaAdapter.generate(baseUrl, model, 'prompt', {
      ...defaultOptions(),
      maxOutputTokens: 2048,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.num_predict).toBe(2048);
  });

  it('omits num_predict when maxOutputTokens not provided', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ response: 'ok' }));

    await ollamaAdapter.generate(baseUrl, model, 'prompt', defaultOptions());

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.num_predict).toBeUndefined();
  });

  it('sets num_ctx from contextWindow when provided', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ response: 'ok' }));

    await ollamaAdapter.generate(baseUrl, model, 'prompt', {
      ...defaultOptions(),
      contextWindow: 32768,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.num_ctx).toBe(32768);
  });

  it('does not default num_ctx to 8192 when contextWindow is absent', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ response: 'ok' }));

    await ollamaAdapter.generate(baseUrl, model, 'prompt', defaultOptions());

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.num_ctx).toBeUndefined();
  });

  it('always sends keep_alive of 10m', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ response: 'ok' }));

    await ollamaAdapter.generate(baseUrl, model, 'prompt', defaultOptions());

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.keep_alive).toBe('10m');
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

  it('throws LLMError with kind server-error on a 500', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500, 'internal error'));

    try {
      await ollamaAdapter.generate(baseUrl, model, 'prompt', defaultOptions());
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(isLLMError(err) && err.kind).toBe('server-error');
      expect((err as Error).message).toContain('Ollama generate error');
      expect((err as Error).message).toContain('internal error');
    }
  });

  it('throws LLMError with kind model-missing on a 404', async () => {
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
      expect(isLLMError(err) && err.kind).toBe('model-missing');
    }
  });

  it('passes topP to generate body as top_p', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ response: 'ok' }));

    await ollamaAdapter.generate(baseUrl, model, 'prompt', {
      ...defaultOptions(),
      topP: 0.9,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.top_p).toBe(0.9);
  });

  it('defaults eval_count to 0 when absent but prompt_eval_count present', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ response: 'result', prompt_eval_count: 10 }),
    );

    const result = await ollamaAdapter.generate(baseUrl, model, 'prompt', defaultOptions());

    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 0 });
  });
});

// ── generate — structured output (JSON Schema enforcement) ───────────────────

describe('ollamaAdapter.generate — structured output', () => {
  const baseUrl = 'http://localhost:11434';
  const model = 'llama3';

  it('omits format entirely for text mode', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ response: 'ok' }));

    await ollamaAdapter.generate(baseUrl, model, 'prompt', defaultOptions());

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.format).toBeUndefined();
  });

  it('throws when json mode has no responseSchema', async () => {
    await expect(
      ollamaAdapter.generate(baseUrl, model, 'p', {
        ...defaultOptions(),
        responseFormat: 'json',
        schemaName: 'x',
      }),
    ).rejects.toThrow('responseSchema');
    // Guard throws before any network call.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when json mode has no schemaName', async () => {
    await expect(
      ollamaAdapter.generate(baseUrl, model, 'p', {
        ...defaultOptions(),
        responseFormat: 'json',
        responseSchema: SAMPLE_SCHEMA,
      }),
    ).rejects.toThrow('schemaName');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when text mode carries a responseSchema', async () => {
    await expect(
      ollamaAdapter.generate(baseUrl, model, 'p', {
        ...defaultOptions(),
        responseFormat: 'text',
        responseSchema: SAMPLE_SCHEMA,
      }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('never emits json_object on the wire', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ response: '{}' }));

    await ollamaAdapter.generate(baseUrl, model, 'p', {
      ...defaultOptions(),
      responseFormat: 'json',
      responseSchema: SAMPLE_SCHEMA,
      schemaName: 'x',
    });

    const serialized = String(mockFetch.mock.calls[0][1].body);
    expect(serialized).not.toContain('json_object');
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

  it('sets num_ctx from contextWindow in chatStream', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}, ndjsonStream([
      JSON.stringify({ message: { content: '' }, done: true }),
    ])));

    for await (const chunk of ollamaAdapter.chatStream(baseUrl, model, messages, {
      ...defaultOptions(),
      contextWindow: 16384,
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

  it('attaches a retryable kind to chatStream error', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(503, 'unavailable'));

    try {
      const gen = ollamaAdapter.chatStream(baseUrl, model, messages, defaultOptions());
      await gen[Symbol.asyncIterator]().next();
      expect.fail('should have thrown');
    } catch (err) {
      expect(isLLMError(err) && err.kind).toBe('server-error');
      expect(isLLMError(err) && err.retryable).toBe(true);
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

  it('populates usage on the done chunk from eval counts', async () => {
    const chunks: { usage?: { promptTokens: number; completionTokens: number } }[] = [];
    mockFetch.mockResolvedValueOnce(okResponse({}, ndjsonStream([
      JSON.stringify({ message: { content: 'hi' }, done: false }),
      JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 42, eval_count: 7 }),
    ])));

    for await (const chunk of ollamaAdapter.chatStream(baseUrl, model, messages, defaultOptions())) {
      chunks.push({ usage: chunk.usage });
    }

    // Only the terminal (done) chunk carries usage.
    expect(chunks[chunks.length - 1].usage).toEqual({ promptTokens: 42, completionTokens: 7 });
  });

  it('emits a synthetic terminal chunk when the stream ends without a done frame', async () => {
    const doneFlags: boolean[] = [];
    // Stream with content but NO done:true frame — the upstream just ends.
    mockFetch.mockResolvedValueOnce(okResponse({}, ndjsonStream([
      JSON.stringify({ message: { content: 'hi' }, done: false }),
    ])));

    for await (const chunk of ollamaAdapter.chatStream(baseUrl, model, messages, defaultOptions())) {
      doneFlags.push(chunk.done);
    }

    // A terminal done:true chunk must still be emitted (bug 10).
    expect(doneFlags[doneFlags.length - 1]).toBe(true);
  });

  it('always sends keep_alive of 10m in chatStream', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}, ndjsonStream([
      JSON.stringify({ message: { content: '' }, done: true }),
    ])));

    for await (const chunk of ollamaAdapter.chatStream(baseUrl, model, messages, defaultOptions())) {
      void chunk;
    }

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.keep_alive).toBe('10m');
  });

  it('passes topP to chatStream body as top_p', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}, ndjsonStream([
      JSON.stringify({ message: { content: '' }, done: true }),
    ])));

    for await (const chunk of ollamaAdapter.chatStream(baseUrl, model, messages, {
      ...defaultOptions(),
      topP: 0.95,
    })) {
      void chunk;
    }

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.top_p).toBe(0.95);
  });

  it('maps maxOutputTokens to num_predict in chatStream', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}, ndjsonStream([
      JSON.stringify({ message: { content: '' }, done: true }),
    ])));

    for await (const chunk of ollamaAdapter.chatStream(baseUrl, model, messages, {
      ...defaultOptions(),
      maxOutputTokens: 800,
    })) {
      void chunk;
    }

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.num_predict).toBe(800);
  });

  it('omits num_predict in chatStream when maxOutputTokens not provided', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}, ndjsonStream([
      JSON.stringify({ message: { content: '' }, done: true }),
    ])));

    for await (const chunk of ollamaAdapter.chatStream(baseUrl, model, messages, defaultOptions())) {
      void chunk;
    }

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.num_predict).toBeUndefined();
  });
});

// ── listModels ───────────────────────────────────────────────────────────────

describe('ollamaAdapter.listModels', () => {
  const baseUrl = 'http://localhost:11434';

  it('returns model names without enrichment when no selectedModel', async () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    mockFetch.mockResolvedValueOnce(
      okResponse({ models: names.map((n) => ({ name: n })) }),
    );

    const result = await ollamaAdapter.listModels(baseUrl, new AbortController().signal);

    expect(result).toHaveLength(7);
    for (const m of result) {
      expect(m.contextLength).toBeUndefined();
    }
    // No /api/show call was made — only the single /api/tags fetch.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('enriches the selected model on demand even past index 5', async () => {
    const names = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
    // /api/tags
    mockFetch.mockResolvedValueOnce(
      okResponse({ models: names.map((n) => ({ name: n })) }),
    );
    // /api/show for the selected model (m6), only.
    mockFetch.mockResolvedValueOnce(
      okResponse({ parameters: 'num_ctx\t4096' }),
    );

    const result = await ollamaAdapter.listModels(baseUrl, new AbortController().signal, 'm6');

    const m6 = result.find((m) => m.id === 'm6');
    expect(m6?.contextLength).toBe(4096);
    // The other five were not enriched.
    expect(result.find((m) => m.id === 'm1')?.contextLength).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(2); // /api/tags + one /api/show
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

  it('leaves contextLength undefined when /api/show fails for the selected model', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ models: [{ name: 'model1' }] }),
    );
    // /api/show fails
    mockFetch.mockRejectedValueOnce(new Error('timeout'));

    const result = await ollamaAdapter.listModels(baseUrl, new AbortController().signal, 'model1');

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

    const result = await ollamaAdapter.listModels(baseUrl, new AbortController().signal, 'qwen');

    expect(result[0].contextLength).toBe(32768);
  });

  it('does not enrich when selectedModel is not in the list', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ models: [{ name: 'm1' }, { name: 'm2' }] }),
    );

    const result = await ollamaAdapter.listModels(baseUrl, new AbortController().signal, 'absent');

    // No /api/show call: the selected model wasn't found, so nothing to enrich.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ id: 'm1' }, { id: 'm2' }]);
  });
});

// ── checkStatus ──────────────────────────────────────────────────────────────

describe('ollamaAdapter.checkStatus', () => {
  const baseUrl = 'http://localhost:11434';

  it('returns connected with models on success', async () => {
    // checkStatus hits /api/tags for connectivity …
    mockFetch.mockResolvedValueOnce(okResponse({ models: [{ name: 'llama3' }] }));
    // … then listModels fetches /api/tags again (no selectedModel → no enrichment).
    mockFetch.mockResolvedValueOnce(okResponse({ models: [{ name: 'llama3' }] }));

    const result = await ollamaAdapter.checkStatus(baseUrl, new AbortController().signal);

    expect(result.connected).toBe(true);
    expect(result.models).toEqual([{ id: 'llama3' }]);
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
    // checkStatus /api/tags (ok, but we pass an empty list via the second fetch).
    mockFetch.mockResolvedValueOnce(okResponse({ models: [] }));
    mockFetch.mockResolvedValueOnce(okResponse({ models: [] }));

    const result = await ollamaAdapter.checkStatus(baseUrl, new AbortController().signal);

    expect(result.connected).toBe(true);
    expect(result.models).toEqual([]);
    expect(result.selectedModel).toBeNull();
  });
});
