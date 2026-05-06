import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { checkLMStudioStatus, listModels, generate, chatStream } from '@/lib/llm/lmstudioBrowserClient';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lmstudioBrowserClient', () => {
  describe('checkLMStudioStatus', () => {
    it('returns connected with models on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'llama3', loaded_instances: [{ config: { context_length: 8192 } }] },
            { id: 'mistral' },
          ],
        }),
      });

      const result = await checkLMStudioStatus('http://localhost:1234');
      expect(result.connected).toBe(true);
      expect(result.models).toEqual([
        { id: 'llama3', contextLength: 8192 },
        { id: 'mistral', contextLength: undefined },
      ]);
      expect(result.selectedModel).toBe('llama3');
    });

    it('returns disconnected on failure', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await checkLMStudioStatus('http://localhost:1234');
      expect(result.connected).toBe(false);
      expect(result.models).toEqual([]);
      expect(result.selectedModel).toBeNull();
    });
  });

  describe('listModels', () => {
    it('parses model IDs and extracts context length', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: 'llama3', loaded_instances: [{ config: { context_length: 4096 } }] }] }),
      });
      expect(await listModels('http://localhost:1234')).toEqual([{ id: 'llama3', contextLength: 4096 }]);
    });

    it('returns empty on failure', async () => {
      mockFetch.mockRejectedValue(new Error('fail'));
      expect(await listModels('http://localhost:1234')).toEqual([]);
    });
  });

  describe('generate', () => {
    it('returns content from OpenAI format', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'result text' } }] }),
      });
      const result = await generate('http://localhost:1234', 'llama3', 'prompt');
      expect(result).toBe('result text');
    });

    it('throws on non-OK response', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Error' });
      await expect(generate('http://localhost:1234', 'llama3', 'prompt')).rejects.toThrow();
    });

    it('handles model loading failure error message', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'failed to load model',
      });
      await expect(generate('http://localhost:1234', 'bad-model', 'prompt')).rejects.toThrow();
    });
  });

  describe('chatStream', () => {
    it('returns readable stream on success', async () => {
      const mockBody = new ReadableStream();
      mockFetch.mockResolvedValue({ ok: true, body: mockBody });
      const result = await chatStream('http://localhost:1234', 'llama3', [{ role: 'user', content: 'hi' }]);
      expect(result).toBe(mockBody);
    });

    it('throws on missing body', async () => {
      mockFetch.mockResolvedValue({ ok: true, body: null });
      await expect(
        chatStream('http://localhost:1234', 'llama3', [{ role: 'user', content: 'hi' }])
      ).rejects.toThrow();
    });
  });
});
