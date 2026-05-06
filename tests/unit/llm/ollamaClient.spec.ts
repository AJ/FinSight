import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { checkOllamaRunning, listModels, generate, chatStream, OllamaError } from '@/lib/llm/ollamaClient';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ollamaClient', () => {
  describe('checkOllamaRunning', () => {
    it('returns true when server responds OK', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      expect(await checkOllamaRunning()).toBe(true);
    });

    it('returns false when server is unreachable', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      expect(await checkOllamaRunning()).toBe(false);
    });

    it('returns false on non-OK status', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });
      expect(await checkOllamaRunning()).toBe(false);
    });
  });

  describe('listModels', () => {
    it('parses model names and enriches with context length from /api/show', async () => {
      // /api/tags
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3' }, { name: 'qwen2.5' }] }),
      });
      // /api/show for llama3
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ parameters: 'num_ctx\t8192\nnum_predict\t128' }),
      });
      // /api/show for qwen2.5
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ parameters: 'num_ctx\t32768\nnum_predict\t128' }),
      });

      const models = await listModels();
      expect(models).toEqual([
        { id: 'llama3', contextLength: 8192 },
        { id: 'qwen2.5', contextLength: 32768 },
      ]);
    });

    it('returns empty array on non-OK response', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });
      expect(await listModels()).toEqual([]);
    });

    it('returns empty array on network error', async () => {
      mockFetch.mockRejectedValue(new Error('fail'));
      expect(await listModels()).toEqual([]);
    });

    it('gracefully handles /api/show failure', async () => {
      // /api/tags
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3' }] }),
      });
      // /api/show fails
      mockFetch.mockResolvedValueOnce({ ok: false });

      const models = await listModels();
      expect(models).toEqual([{ id: 'llama3', contextLength: undefined }]);
    });
  });

  describe('generate', () => {
    it('returns response text on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ response: '{"type":"bank"}' }),
      });
      const result = await generate('http://localhost:11434', 'llama3', 'parse this');
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
        await generate('http://localhost:11434', 'bad-model', 'test');
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(OllamaError);
        expect((e as OllamaError).retryable).toBe(false);
      }
    });

    it('throws retryable error on 500', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });
      try {
        await generate('http://localhost:11434', 'llama3', 'test');
      } catch (e) {
        expect((e as OllamaError).retryable).toBe(true);
      }
    });

    it('throws retryable error on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      try {
        await generate('http://localhost:11434', 'llama3', 'test');
      } catch (e) {
        expect((e as OllamaError).retryable).toBe(true);
      }
    });
  });

  describe('chatStream', () => {
    it('returns readable stream on success', async () => {
      const mockBody = new ReadableStream();
      mockFetch.mockResolvedValue({ ok: true, body: mockBody });
      const result = await chatStream('http://localhost:11434', 'llama3', [{ role: 'user', content: 'hi' }]);
      expect(result).toBe(mockBody);
    });

    it('throws error when body is null', async () => {
      mockFetch.mockResolvedValue({ ok: true, body: null });
      await expect(
        chatStream('http://localhost:11434', 'llama3', [{ role: 'user', content: 'hi' }])
      ).rejects.toThrow();
    });

    it('throws error on non-OK response', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Error' });
      await expect(
        chatStream('http://localhost:11434', 'llama3', [{ role: 'user', content: 'hi' }])
      ).rejects.toThrow();
    });
  });
});
