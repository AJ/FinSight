import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getContextWindowInfo } from '@/lib/llm/contextWindow';
import type { ModelInfo } from '@/lib/llm/types';

// Mock settings store
const mockGetState = vi.fn();
vi.mock('@/lib/store/settingsStore', () => ({
  useSettingsStore: { getState: () => mockGetState() },
}));

// Mock LLM client
const mockListModels = vi.fn();
vi.mock('@/lib/llm/index', () => ({
  getClient: () => ({ listModels: mockListModels }),
}));

describe('getContextWindowInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns context length from settings store when available', async () => {
    mockGetState.mockReturnValue({
      llmProvider: 'lmstudio',
      llmServerUrl: 'http://localhost:1234',
      llmModel: 'llama3',
      llmModelContextLength: 16244,
    });

    const result = await getContextWindowInfo();

    expect(result).toEqual({
      contextLength: 16244,
      source: 'settings_cache',
      provider: 'lmstudio',
      modelId: 'llama3',
    });
    // Should NOT call listModels when store has a value
    expect(mockListModels).not.toHaveBeenCalled();
  });

  it('falls back to listModels when store value is null', async () => {
    mockGetState.mockReturnValue({
      llmProvider: 'ollama',
      llmServerUrl: 'http://localhost:11434',
      llmModel: 'llama3',
      llmModelContextLength: null,
    });

    const modelInfo: ModelInfo = { id: 'llama3', contextLength: 8192 };
    mockListModels.mockResolvedValue([modelInfo]);

    const result = await getContextWindowInfo();

    expect(result).toEqual({
      contextLength: 8192,
      source: 'listModels_fallback',
      provider: 'ollama',
      modelId: 'llama3',
    });
    expect(mockListModels).toHaveBeenCalledWith('http://localhost:11434');
  });

  it('returns undefined contextLength when model not found in listModels', async () => {
    mockGetState.mockReturnValue({
      llmProvider: 'ollama',
      llmServerUrl: 'http://localhost:11434',
      llmModel: 'nonexistent',
      llmModelContextLength: null,
    });

    mockListModels.mockResolvedValue([{ id: 'other-model', contextLength: 4096 }]);

    const result = await getContextWindowInfo();

    expect(result.contextLength).toBeUndefined();
    expect(result.modelId).toBe('nonexistent');
  });

  it('returns undefined contextLength when no model configured', async () => {
    mockGetState.mockReturnValue({
      llmProvider: 'ollama',
      llmServerUrl: 'http://localhost:11434',
      llmModel: null,
      llmModelContextLength: null,
    });

    mockListModels.mockResolvedValue([]);

    const result = await getContextWindowInfo();

    expect(result.contextLength).toBeUndefined();
    expect(result.source).toBe('listModels_fallback');
  });

  it('caches listModels result to settings store', async () => {
    const mockSetModelContextLength = vi.fn();
    mockGetState.mockReturnValue({
      llmProvider: 'ollama',
      llmServerUrl: 'http://localhost:11434',
      llmModel: 'llama3',
      llmModelContextLength: null,
      setModelContextLength: mockSetModelContextLength,
    });

    mockListModels.mockResolvedValue([{ id: 'llama3', contextLength: 8192 }]);

    await getContextWindowInfo();

    expect(mockSetModelContextLength).toHaveBeenCalledWith(8192);
  });

  it('handles listModels failure gracefully', async () => {
    mockGetState.mockReturnValue({
      llmProvider: 'ollama',
      llmServerUrl: 'http://localhost:11434',
      llmModel: 'llama3',
      llmModelContextLength: null,
    });

    mockListModels.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await getContextWindowInfo();

    expect(result.contextLength).toBeUndefined();
    expect(result.source).toBe('listModels_fallback');
  });

  it('accepts explicit overrides for server-side usage', async () => {
    mockGetState.mockReturnValue({
      llmProvider: 'lmstudio',
      llmServerUrl: 'http://localhost:1234',
      llmModel: 'llama3',
      llmModelContextLength: null,
    });

    mockListModels.mockResolvedValue([{ id: 'llama3', contextLength: 16244 }]);

    const result = await getContextWindowInfo({
      provider: 'lmstudio',
      baseUrl: 'http://custom:1234',
      model: 'llama3',
    });

    expect(mockListModels).toHaveBeenCalledWith('http://custom:1234');
    expect(result.contextLength).toBe(16244);
  });

  it('falls through to listModels when cached value is 0', async () => {
    mockGetState.mockReturnValue({
      llmProvider: 'ollama',
      llmServerUrl: 'http://localhost:11434',
      llmModel: 'llama3',
      llmModelContextLength: 0,
    });

    mockListModels.mockResolvedValue([{ id: 'llama3', contextLength: 8192 }]);

    const result = await getContextWindowInfo();

    // 0 is not a valid context length — should fall through to listModels
    expect(mockListModels).toHaveBeenCalledWith('http://localhost:11434');
    expect(result.contextLength).toBe(8192);
    expect(result.source).toBe('listModels_fallback');
  });

  it('returns undefined when model found but has no contextLength', async () => {
    mockGetState.mockReturnValue({
      llmProvider: 'ollama',
      llmServerUrl: 'http://localhost:11434',
      llmModel: 'llama3',
      llmModelContextLength: null,
    });

    mockListModels.mockResolvedValue([{ id: 'llama3' }]);

    const result = await getContextWindowInfo();

    expect(result.contextLength).toBeUndefined();
    expect(result.source).toBe('listModels_fallback');
  });

  it('does not cache when listModels returns undefined contextLength', async () => {
    const mockSetModelContextLength = vi.fn();
    mockGetState.mockReturnValue({
      llmProvider: 'ollama',
      llmServerUrl: 'http://localhost:11434',
      llmModel: 'llama3',
      llmModelContextLength: null,
      setModelContextLength: mockSetModelContextLength,
    });

    mockListModels.mockResolvedValue([{ id: 'llama3' }]);

    await getContextWindowInfo();

    expect(mockSetModelContextLength).not.toHaveBeenCalled();
  });

  it('re-reads store on each call', async () => {
    mockGetState
      .mockReturnValueOnce({
        llmProvider: 'lmstudio',
        llmServerUrl: 'http://localhost:1234',
        llmModel: 'llama3',
        llmModelContextLength: 8192,
      })
      .mockReturnValueOnce({
        llmProvider: 'lmstudio',
        llmServerUrl: 'http://localhost:1234',
        llmModel: 'llama3',
        llmModelContextLength: 16244,
      });

    const result1 = await getContextWindowInfo();
    const result2 = await getContextWindowInfo();

    expect(result1.contextLength).toBe(8192);
    expect(result2.contextLength).toBe(16244);
    expect(mockGetState).toHaveBeenCalledTimes(2);
  });
});
