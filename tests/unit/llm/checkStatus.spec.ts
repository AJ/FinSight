import { describe, it, expect, vi, beforeEach } from 'vitest';

import { checkLLMStatus } from '@/lib/llm/checkStatus';
import { useSettingsStore } from '@/lib/store/settingsStore';

// Mock fetch — the only external boundary (LLM HTTP calls go through here)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Helpers ────────────────────────────────────────────────────────────────────

function ollamaConnectedSequence(models: Array<{ name: string }> = []) {
  mockFetch
    .mockResolvedValueOnce({ ok: true, status: 200 }) // root URL check
    .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ models }) }); // /api/tags
}

function lmstudioConnectedSequence(models: Array<{ id: string }> = []) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data: models }),
  }); // /v1/models
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useSettingsStore.setState({
    llmProvider: 'ollama',
    llmServerUrl: 'http://localhost:11434',
    llmModel: 'llama3',
  });
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('checkLLMStatus', () => {
  it('uses store URL and provider when no args given', async () => {
    ollamaConnectedSequence([{ name: 'llama3' }]);

    const result = await checkLLMStatus();

    const settings = useSettingsStore.getState();
    // Root URL check uses the store's server URL
    expect(mockFetch).toHaveBeenCalledWith(
      settings.llmServerUrl,
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(result.connected).toBe(true);
  });

  it('uses provided URL over store URL', async () => {
    ollamaConnectedSequence();

    await checkLLMStatus('http://custom:9999', 'ollama');

    // Root URL check uses the provided URL
    expect(mockFetch).toHaveBeenCalledWith(
      'http://custom:9999',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('uses provided provider over store provider', async () => {
    lmstudioConnectedSequence();

    await checkLLMStatus('http://localhost:1234', 'lmstudio');

    // LM Studio adapter calls /v1/models
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:1234/v1/models',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('delegates to correct client for ollama', async () => {
    ollamaConnectedSequence([{ name: 'qwen2.5' }]);

    const result = await checkLLMStatus('http://localhost:11434', 'ollama');

    expect(result.connected).toBe(true);
    expect(result.models.some((m) => m.id === 'qwen2.5')).toBe(true);
  });

  it('returns disconnected status when server is unreachable', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    const result = await checkLLMStatus('http://localhost:11434', 'ollama');

    expect(result.connected).toBe(false);
    expect(result.models).toEqual([]);
    expect(result.selectedModel).toBeNull();
  });

  it('returns disconnected status on network error (fetch rejects)', async () => {
    // The adapter catches fetch rejections and returns { connected: false }
    mockFetch.mockReset();
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await checkLLMStatus('http://localhost:11434', 'ollama');

    expect(result.connected).toBe(false);
    expect(result.models).toEqual([]);
    expect(result.selectedModel).toBeNull();
  });
});
