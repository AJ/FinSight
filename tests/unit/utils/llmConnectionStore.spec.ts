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

// NOTE: checkLLMStatus never rejects — both adapters (Ollama, OpenAI) wrap their entire
// checkStatus body in bare try/catch returning { connected: false } on any error. The client
// layer adds only try/finally. So no .catch() handler is needed on the store's promise chain.

describe('model context-length refresh', () => {
  it('calls setModelContextLength when connected and model has contextLength', async () => {
    useSettingsStore.setState({ llmModel: 'llama3' });

    // Ollama checkStatus: 1) root URL, 2) /api/tags, 3) /api/show for enrichment
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200 }) // root
      .mockResolvedValueOnce({ // /api/tags
        ok: true,
        status: 200,
        json: () => Promise.resolve({ models: [{ name: 'llama3' }] }),
      })
      .mockResolvedValueOnce({ // /api/show for context length enrichment
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          parameters: 'num_ctx 4096',
          model_info: {},
        }),
      });

    await useLLMConnectionStore.getState().checkConnection();

    // setModelContextLength should have been called with 4096
    const settings = useSettingsStore.getState();
    expect(settings.llmModelContextLength).toBe(4096);
  });
});

describe('provider change auto-invalidation', () => {
  it('re-checks when provider changes', async () => {
    // Use a fresh mock to avoid cross-test interference
    mockFetch.mockReset();
    ollamaConnectedSequence();

    await useLLMConnectionStore.getState().checkConnection();
    const callsAfterFirst = mockFetch.mock.calls.length;

    // Switch to LM Studio — should invalidate cache
    useSettingsStore.setState({ llmProvider: 'lmstudio', llmServerUrl: 'http://localhost:1234' });

    // Set up LM Studio response sequence
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: [] }),
    });

    await useLLMConnectionStore.getState().checkConnection();

    // Second check should have made additional fetch calls (LM Studio = 1 call to /v1/models)
    const callsAfterSecond = mockFetch.mock.calls.length;
    expect(callsAfterSecond).toBeGreaterThan(callsAfterFirst);
  });
});

describe('model change auto-invalidation', () => {
  it('re-checks when model changes', async () => {
    await useLLMConnectionStore.getState().checkConnection();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Change model → cache invalid → next check hits fetch again
    useSettingsStore.setState({ llmModel: 'qwen2.5' });
    ollamaConnectedSequence();
    await useLLMConnectionStore.getState().checkConnection();

    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});

describe('isLoading state', () => {
  it('is true during check and false after completion', async () => {
    // Use a promise we can control to observe isLoading mid-flight
    let resolveCheck: () => void;
    const pendingCheck = new Promise<void>((resolve) => { resolveCheck = resolve; });

    mockFetch.mockReset();
    mockFetch.mockImplementation(() => pendingCheck.then(() => ({ ok: true, status: 200 })));

    const checkPromise = useLLMConnectionStore.getState().checkConnection();

    // isLoading should be true right after initiating
    expect(useLLMConnectionStore.getState().isLoading).toBe(true);

    // Resolve the fetch
    resolveCheck!();
    await checkPromise;

    expect(useLLMConnectionStore.getState().isLoading).toBe(false);
  });
});

describe('error state for disconnected but successful response', () => {
  it('sets error when adapter returns connected: false', async () => {
    mockFetch.mockReset();
    // First call: root check returns non-ok
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const status = await useLLMConnectionStore.getState().checkConnection();

    expect(status.connected).toBe(false);
    expect(useLLMConnectionStore.getState().error).toBe('LLM server not reachable');
  });
});
