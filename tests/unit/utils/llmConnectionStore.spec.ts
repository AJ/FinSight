import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useLLMConnectionStore, checkLLMConnection, getLLMConnectionStatus, subscribeToLLMConnection } from '@/lib/store/llmConnectionStore';
import { useSettingsStore } from '@/lib/store/settingsStore';

// Mock fetch — the only external boundary (LLM HTTP calls go through here)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Helpers ────────────────────────────────────────────────────────────────────

function ollamaRootResponse() {
  return { ok: true, status: 200 };
}

function ollamaModelsResponse(models: Array<{ name: string }> = []) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ models }),
  };
}

function ollamaConnectedSequence(models: Array<{ name: string }> = []) {
  mockFetch
    .mockResolvedValueOnce(ollamaRootResponse())
    .mockResolvedValueOnce(ollamaModelsResponse(models));
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();

  useLLMConnectionStore.getState().clearStatus();
  useSettingsStore.setState({
    llmProvider: 'ollama',
    llmServerUrl: 'http://localhost:11434',
    llmModel: 'llama3',
  });

  // Default: connected Ollama server with no models
  ollamaConnectedSequence();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('useLLMConnectionStore', () => {
  it('checks connection and caches status', async () => {
    const status = await useLLMConnectionStore.getState().checkConnection();

    expect(status.connected).toBe(true);
    expect(getLLMConnectionStatus()).not.toBeNull();
  });

  it('returns cached status within TTL', async () => {
    await useLLMConnectionStore.getState().checkConnection();
    await useLLMConnectionStore.getState().checkConnection();

    // First check: root + /api/tags = 2 fetch calls. Second check uses cache = 0 calls.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('invalidates cache on force', async () => {
    // beforeEach set up 2 responses for the first check; add 2 more for the forced check
    ollamaConnectedSequence();

    await useLLMConnectionStore.getState().checkConnection();
    await useLLMConnectionStore.getState().checkConnection(true);

    // First check: 2 fetch calls. Forced check: 2 more = 4 total.
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('deduplicates concurrent requests', async () => {
    const [s1, s2] = await Promise.all([
      useLLMConnectionStore.getState().checkConnection(),
      useLLMConnectionStore.getState().checkConnection(),
    ]);

    // Only one check (2 fetch calls) — second request reuses in-flight promise
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(s1).toEqual(s2);
  });

  it('handles connection failure', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    const status = await useLLMConnectionStore.getState().checkConnection();

    expect(status.connected).toBe(false);
    expect(status.models).toEqual([]);
  });

  it('clearStatus resets all state', () => {
    useLLMConnectionStore.getState().clearStatus();

    expect(getLLMConnectionStatus()).toBeNull();
  });
});

describe('checkLLMConnection convenience function', () => {
  it('delegates to store', async () => {
    const status = await checkLLMConnection();

    expect(status.connected).toBe(true);
  });
});

describe('invalidateCache', () => {
  it('clears cache metadata but keeps status', async () => {
    await useLLMConnectionStore.getState().checkConnection();
    expect(getLLMConnectionStatus()).not.toBeNull();

    useLLMConnectionStore.getState().invalidateCache();

    const state = useLLMConnectionStore.getState();
    expect(state.lastChecked).toBeNull();
    expect(state.cachedUrl).toBeNull();
    expect(state.status).not.toBeNull();
  });
});

describe('auto-invalidation on settings change', () => {
  it('re-checks when URL changes', async () => {
    await useLLMConnectionStore.getState().checkConnection();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Change URL → cache invalid → next check hits fetch again
    useSettingsStore.setState({ llmServerUrl: 'http://localhost:9999' });
    ollamaConnectedSequence();
    await useLLMConnectionStore.getState().checkConnection();

    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});

describe('subscribeToLLMConnection', () => {
  it('calls callback on state changes', async () => {
    const callback = vi.fn();
    const unsubscribe = subscribeToLLMConnection(callback);

    await useLLMConnectionStore.getState().checkConnection();

    expect(callback).toHaveBeenCalled();
    unsubscribe();
  });
});
