import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { checkOllamaStatus, listModels, generate, chatStream } from '@/lib/llm/ollamaBrowserClient';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ollamaBrowserClient', () => {
  describe('checkOllamaStatus', () => {
    it('returns connected with models on success', async () => {
      // Root check
      mockFetch.mockResolvedValueOnce({ ok: true });
      // /api/tags call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3' }, { name: 'qwen2.5' }] }),
      });
      // /api/show for llama3
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ parameters: 'num_ctx\t4096' }),
      });
      // /api/show for qwen2.5
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ parameters: 'num_ctx\t8192' }),
      });

      const result = await checkOllamaStatus('http://localhost:11434');
      expect(result.connected).toBe(true);
      expect(result.models).toEqual([
        { id: 'llama3', contextLength: 4096 },
        { id: 'qwen2.5', contextLength: 8192 },
      ]);
      expect(result.selectedModel).toBe('llama3');
    });

    it('returns disconnected on failure', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await checkOllamaStatus('http://localhost:11434');
      expect(result.connected).toBe(false);
      expect(result.models).toEqual([]);
      expect(result.selectedModel).toBeNull();
    });

    it('returns null selectedModel when no models', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] }),
      });

      const result = await checkOllamaStatus('http://localhost:11434');
      expect(result.connected).toBe(true);
      expect(result.selectedModel).toBeNull();
    });
  });

  describe('listModels', () => {
    it('parses model names and enriches with context length', async () => {
      // /api/tags
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3' }] }),
      });
      // /api/show
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ parameters: 'num_ctx\t4096' }),
      });

      const models = await listModels('http://localhost:11434');
      expect(models).toEqual([{ id: 'llama3', contextLength: 4096 }]);
    });

    it('returns empty on failure', async () => {
      mockFetch.mockRejectedValue(new Error('fail'));
      expect(await listModels('http://localhost:11434')).toEqual([]);
    });
  });

  describe('generate', () => {
    it('returns response text on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ response: 'result text' }),
      });
      const result = await generate('http://localhost:11434', 'llama3', 'prompt');
      expect(result).toBe('result text');
    });

    it('throws on non-OK response', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Error' });
      await expect(generate('http://localhost:11434', 'llama3', 'prompt')).rejects.toThrow();
    });
  });

  describe('chatStream', () => {
    it('returns readable stream on success', async () => {
      const mockBody = new ReadableStream();
      mockFetch.mockResolvedValue({ ok: true, body: mockBody });
      const result = await chatStream('http://localhost:11434', 'llama3', [{ role: 'user', content: 'hi' }]);
      expect(result).toBe(mockBody);
    });

    it('throws on missing body', async () => {
      mockFetch.mockResolvedValue({ ok: true, body: null });
      await expect(
        chatStream('http://localhost:11434', 'llama3', [{ role: 'user', content: 'hi' }])
      ).rejects.toThrow();
    });
  });
});
