import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { checkLMStudioRunning, listModels, generate, chatStream, LMStudioError } from '@/lib/llm/lmstudioClient';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lmstudioClient', () => {
  describe('checkLMStudioRunning', () => {
    it('returns true when server responds OK', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      expect(await checkLMStudioRunning()).toBe(true);
    });

    it('returns false when server is unreachable', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      expect(await checkLMStudioRunning()).toBe(false);
    });
  });

  describe('listModels', () => {
    it('parses model IDs and extracts context length from loaded_instances', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'llama3', loaded_instances: [{ config: { context_length: 8192 } }] },
            { id: 'mistral', loaded_instances: [] },
            { id: 'qwen2.5' },
          ],
        }),
      });
      const models = await listModels();
      expect(models).toEqual([
        { id: 'llama3', contextLength: 8192 },
        { id: 'mistral', contextLength: undefined },
        { id: 'qwen2.5', contextLength: undefined },
      ]);
    });

    it('returns empty array on failure', async () => {
      mockFetch.mockRejectedValue(new Error('fail'));
      expect(await listModels()).toEqual([]);
    });
  });

  describe('generate', () => {
    it('returns content from OpenAI format response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"type":"bank"}' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
      });
      const result = await generate('http://localhost:1234', 'llama3', 'parse this');
      expect(result).toBe('{"type":"bank"}');
    });

    it('throws non-retryable error on 404', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'model not found',
      });
      try {
        await generate('http://localhost:1234', 'bad-model', 'test');
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(LMStudioError);
        expect((e as LMStudioError).retryable).toBe(false);
      }
    });

    it('throws retryable error on 500', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Error' });
      try {
        await generate('http://localhost:1234', 'llama3', 'test');
      } catch (e) {
        expect((e as LMStudioError).retryable).toBe(true);
      }
    });

    it('throws retryable error on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      try {
        await generate('http://localhost:1234', 'llama3', 'test');
      } catch (e) {
        expect((e as LMStudioError).retryable).toBe(true);
      }
    });
  });

  describe('chatStream', () => {
    it('returns readable stream on success', async () => {
      const mockBody = new ReadableStream();
      mockFetch.mockResolvedValue({ ok: true, body: mockBody });
      const result = await chatStream('http://localhost:1234', 'llama3', [{ role: 'user', content: 'hi' }]);
      expect(result).toBe(mockBody);
    });

    it('throws error on missing body', async () => {
      mockFetch.mockResolvedValue({ ok: true, body: null });
      await expect(
        chatStream('http://localhost:1234', 'llama3', [{ role: 'user', content: 'hi' }])
      ).rejects.toThrow();
    });
  });
});
