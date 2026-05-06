import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getBrowserClient } from '@/lib/llm/index';
import { useSettingsStore } from '@/lib/store/settingsStore';
import type { LLMClient } from '@/lib/llm/types';

vi.mock('@/lib/llm/index', () => ({
  getBrowserClient: vi.fn(),
}));

import { checkLLMStatus } from '@/lib/llm/checkStatus';

function makeLLMClient(checkStatusOverride?: LLMClient['checkStatus']): LLMClient {
  return {
    checkStatus: checkStatusOverride ?? vi.fn().mockResolvedValue({
      connected: false,
      models: [],
      selectedModel: null,
    }),
    listModels: vi.fn().mockResolvedValue([]),
    generate: vi.fn().mockResolvedValue(''),
    chatStream: vi.fn().mockResolvedValue(new ReadableStream()),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkLLMStatus', () => {
  it('uses store URL and provider when no args given', async () => {
    const mockCheckStatus = vi.fn().mockResolvedValue({
      connected: true,
      models: [{ id: 'llama3' }],
      selectedModel: 'llama3',
    });
    vi.mocked(getBrowserClient).mockReturnValue(makeLLMClient(mockCheckStatus));

    const result = await checkLLMStatus();

    const settings = useSettingsStore.getState();
    expect(getBrowserClient).toHaveBeenCalledWith(settings.llmProvider);
    expect(mockCheckStatus).toHaveBeenCalledWith(settings.llmServerUrl);
    expect(result.connected).toBe(true);
  });

  it('uses provided URL over store URL', async () => {
    const mockCheckStatus = vi.fn().mockResolvedValue({
      connected: false,
      models: [],
      selectedModel: null,
    });
    vi.mocked(getBrowserClient).mockReturnValue(makeLLMClient(mockCheckStatus));

    await checkLLMStatus('http://custom:9999', 'ollama');

    expect(mockCheckStatus).toHaveBeenCalledWith('http://custom:9999');
  });

  it('uses provided provider over store provider', async () => {
    const mockCheckStatus = vi.fn().mockResolvedValue({
      connected: false,
      models: [],
      selectedModel: null,
    });
    vi.mocked(getBrowserClient).mockReturnValue(makeLLMClient(mockCheckStatus));

    await checkLLMStatus(undefined, 'lmstudio');

    expect(getBrowserClient).toHaveBeenCalledWith('lmstudio');
  });

  it('delegates to correct browser client for ollama', async () => {
    const mockCheckStatus = vi.fn().mockResolvedValue({
      connected: true,
      models: [{ id: 'qwen2.5', contextLength: 8192 }],
      selectedModel: 'qwen2.5',
    });
    vi.mocked(getBrowserClient).mockReturnValue(makeLLMClient(mockCheckStatus));

    const result = await checkLLMStatus('http://localhost:11434', 'ollama');

    expect(result.connected).toBe(true);
    expect(result.models).toEqual([{ id: 'qwen2.5', contextLength: 8192 }]);
  });
});
