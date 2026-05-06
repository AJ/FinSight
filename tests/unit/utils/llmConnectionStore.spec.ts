import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/llm/checkStatus', () => ({
  checkLLMStatus: vi.fn(),
}));

vi.mock('@/lib/store/settingsStore', () => ({
  useSettingsStore: {
    getState: vi.fn(),
  },
}));

import { useLLMConnectionStore, checkLLMConnection, getLLMConnectionStatus } from '@/lib/store/llmConnectionStore';
import { checkLLMStatus } from '@/lib/llm/checkStatus';
import { useSettingsStore } from '@/lib/store/settingsStore';

const mockCheckLLMStatus = vi.mocked(checkLLMStatus);
const mockGetSettings = vi.mocked(useSettingsStore.getState);

beforeEach(() => {
  vi.clearAllMocks();
  useLLMConnectionStore.getState().clearStatus();
  mockGetSettings.mockReturnValue({
    llmProvider: 'lmstudio',
    llmServerUrl: 'http://localhost:1234',
    llmModel: 'test-model',
    setModelContextLength: vi.fn(),
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
});

describe('useLLMConnectionStore', () => {
  it('checks connection and caches status', async () => {
    mockCheckLLMStatus.mockResolvedValue({ connected: true, models: [{ id: 'test-model', contextLength: 4096 }], selectedModel: null });
    const status = await useLLMConnectionStore.getState().checkConnection();
    expect(status.connected).toBe(true);
    expect(getLLMConnectionStatus()).not.toBeNull();
  });

  it('returns cached status within TTL', async () => {
    mockCheckLLMStatus.mockResolvedValue({ connected: true, models: [{ id: 'test-model', contextLength: 4096 }], selectedModel: null });
    await useLLMConnectionStore.getState().checkConnection();
    await useLLMConnectionStore.getState().checkConnection();
    expect(mockCheckLLMStatus).toHaveBeenCalledTimes(1);
  });

  it('invalidates cache on force', async () => {
    mockCheckLLMStatus.mockResolvedValue({ connected: true, models: [{ id: 'test-model', contextLength: 4096 }], selectedModel: null });
    await useLLMConnectionStore.getState().checkConnection();
    await useLLMConnectionStore.getState().checkConnection(true);
    expect(mockCheckLLMStatus).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent requests', async () => {
    mockCheckLLMStatus.mockResolvedValue({ connected: true, models: [{ id: 'test-model', contextLength: 4096 }], selectedModel: null });
    const [s1, s2] = await Promise.all([
      useLLMConnectionStore.getState().checkConnection(),
      useLLMConnectionStore.getState().checkConnection(),
    ]);
    expect(mockCheckLLMStatus).toHaveBeenCalledTimes(1);
    expect(s1).toEqual(s2);
  });

  it('handles connection failure', async () => {
    mockCheckLLMStatus.mockResolvedValue({ connected: false, models: [], selectedModel: null });
    const status = await useLLMConnectionStore.getState().checkConnection();
    expect(status.connected).toBe(false);
  });

  it('clearStatus resets all state', () => {
    useLLMConnectionStore.getState().clearStatus();
    expect(getLLMConnectionStatus()).toBeNull();
  });
});

describe('checkLLMConnection convenience function', () => {
  it('delegates to store', async () => {
    mockCheckLLMStatus.mockResolvedValue({ connected: true, models: [{ id: 'test-model', contextLength: 4096 }], selectedModel: null });
    const status = await checkLLMConnection();
    expect(status.connected).toBe(true);
  });
});
