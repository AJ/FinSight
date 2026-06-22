import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getContextWindowInfo,
  calculateMaxOutputTokens,
  calculateMaxInputTokens,
  calculateMaxItems,
  overflowKind,
  MIN_VIABLE_CONTEXT_TOKENS,
  estimateTokens,
  CHARS_PER_TOKEN,
} from '@/lib/llm/contextWindow';
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
    expect(mockListModels).toHaveBeenCalledWith('http://localhost:11434', 'llama3');
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

  it('does not write the settings store from the read path', async () => {
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

    // Read-only: the cache is written by model selection (settings UI), not by this lookup.
    expect(mockSetModelContextLength).not.toHaveBeenCalled();
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

    expect(mockListModels).toHaveBeenCalledWith('http://custom:1234', 'llama3');
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
    expect(mockListModels).toHaveBeenCalledWith('http://localhost:11434', 'llama3');
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

describe('calculateMaxOutputTokens', () => {
  it('returns undefined when contextWindowTokens is undefined', () => {
    expect(calculateMaxOutputTokens(undefined, 'test prompt')).toBeUndefined();
  });

  it('calculates budget: output is a fraction of the room left after input', () => {
    // Ratio buffers: output = floor((window − buffered input) / (1 + OUTPUT_BUFFER_RATIO)).
    // 16000 window, 1000-char stage prompt (~435 tokens) → ~14000 output regardless of the
    // exact system-prompt size, because the buffer is fractional rather than a flat subtract.
    const stagePrompt = 'a'.repeat(1000);
    const result = calculateMaxOutputTokens(16000, stagePrompt);
    expect(result).toBeGreaterThan(13500);
    expect(result).toBeLessThan(14500);
  });

  it('returns 0 (overflow) when the full input meets the window', () => {
    // Full-input semantics (no internal SYSTEM_PROMPT_TOKENS): 1500 chars ≈ 653 tokens,
    // ×1.10 ≈ 718 ≥ 500 window → overflow sentinel 0.
    expect(calculateMaxOutputTokens(500, 'a'.repeat(1500))).toBe(0);
  });

  it('returns a small positive budget for a tight-but-non-overflowing window (no floor)', () => {
    // No MIN_OUTPUT_TOKENS floor. Under ratio buffers a tight window yields a small but
    // positive output room — the buffer is a fraction of the room, so it cannot zero it out.
    const stagePrompt = 'a'.repeat(1000);
    const result = calculateMaxOutputTokens(1100, stagePrompt);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(700);
  });

  it('accounts for longer prompts by reducing available output tokens', () => {
    const shortPrompt = 'short';
    const longPrompt = 'a'.repeat(10000);
    const resultShort = calculateMaxOutputTokens(16000, shortPrompt);
    const resultLong = calculateMaxOutputTokens(16000, longPrompt);
    expect(resultShort!).toBeGreaterThan(resultLong!);
  });

  it('output grows slower than the window (ratio buffer, not a flat subtract)', () => {
    // Same prompt, two windows. A FLAT output buffer subtracts a constant, so output grows
    // 1:1 with the window (Δout = Δwindow = 8000). A RATIO buffer holds back a fraction of
    // the room, so output grows slower (Δout = 8000 / 1.1 ≈ 7273).
    const prompt = 'a'.repeat(1000);
    const outSmall = calculateMaxOutputTokens(8000, prompt)!;
    const outLarge = calculateMaxOutputTokens(16000, prompt)!;
    expect(outLarge - outSmall).toBeLessThan(8000);
  });

  it('never returns a negative number (the output buffer is a fraction of the room)', () => {
    expect(calculateMaxOutputTokens(800, 'a'.repeat(1000))).toBeGreaterThanOrEqual(0);
  });
});

describe('calculateMaxInputTokens (non-linear regime: cap output, size variable input)', () => {
  it('returns undefined when contextWindow is undefined', () => {
    expect(calculateMaxInputTokens(undefined, 'fixed', 800)).toBeUndefined();
  });

  it('returns input room = window − fixed − outputCap (buffered)', () => {
    // fixed '', cap 800, window 8192 → room for variable input, strictly less than 8192 − 800.
    const room = calculateMaxInputTokens(8192, '', 800)!;
    expect(room).toBeGreaterThan(0);
    expect(room).toBeLessThan(8192 - 800);
  });

  it('larger output cap leaves less input room', () => {
    expect(calculateMaxInputTokens(8192, '', 2000)!).toBeLessThan(calculateMaxInputTokens(8192, '', 800)!);
  });

  it('returns 0 when fixed + outputCap already fills the window', () => {
    // 1500 chars ≈ 653 tokens fixed, ×1.10 ≈ 718; + cap 100 ×1.10 = 110 → 828 ≥ 500 → 0.
    expect(calculateMaxInputTokens(500, 'a'.repeat(1500), 100)).toBe(0);
  });

  it('accounts for fixed input size (more fixed text → less variable room)', () => {
    expect(calculateMaxInputTokens(8192, 'a'.repeat(5000), 800)!)
      .toBeLessThan(calculateMaxInputTokens(8192, '', 800)!);
  });
});

describe('calculateMaxItems (linear-coupled regime: per-item a,b joint solve)', () => {
  it('returns undefined when contextWindow is undefined', () => {
    expect(calculateMaxItems(undefined, 'fixed', 60, 15)).toBeUndefined();
  });

  it('returns roughly floor((window − fixed) / (a + b))', () => {
    // window 8192, fixed '', a=60, b=15. Per-item cost is buffer-inflated to
    // (60+15)×1.1 ≈ 82.5 → ~99 items.
    const n = calculateMaxItems(8192, '', 60, 15)!;
    expect(n).toBeGreaterThan(90);
    expect(n).toBeLessThan(110);
  });

  it('larger per-item cost → fewer items', () => {
    expect(calculateMaxItems(8192, '', 60, 15)!).toBeGreaterThan(calculateMaxItems(8192, '', 120, 30)!);
  });

  it('fixed overhead reduces the item count', () => {
    expect(calculateMaxItems(8192, 'a'.repeat(5000), 60, 15)!)
      .toBeLessThan(calculateMaxItems(8192, '', 60, 15)!);
  });

  it('returns 0 when per-item cost is non-positive', () => {
    expect(calculateMaxItems(8192, '', 0, 0)).toBe(0);
  });
});

describe('overflowKind (preflight overflow classification)', () => {
  it('returns model-too-small when the window is below the viable minimum', () => {
    expect(overflowKind(MIN_VIABLE_CONTEXT_TOKENS - 1)).toBe('model-too-small');
  });

  it('returns input-too-large when the window is at/above the viable minimum', () => {
    expect(overflowKind(MIN_VIABLE_CONTEXT_TOKENS)).toBe('input-too-large');
    expect(overflowKind(8192)).toBe('input-too-large');
  });
});

// Cross-cutting: the three budget functions must stay stable and sane across the full range
// of context sizes a local model might report — from small (512–4096) to very large
// (128k–1M). No NaN, no false overflow on large windows, and behavior is monotonic.
describe('budget stability across context sizes', () => {
  const smallWindows = [512, 1024, 2048, 4096];
  const largeWindows = [131072, 262144, 1048576];

  it('calculateMaxOutputTokens: never NaN, never negative, grows with the window', () => {
    const out = [...smallWindows, ...largeWindows].map((w) => calculateMaxOutputTokens(w, 'a'.repeat(1000))!);
    for (const o of out) {
      expect(Number.isFinite(o)).toBe(true);
      expect(o).toBeGreaterThanOrEqual(0);
    }
    // Monotonic non-decreasing across the combined small→large range.
    for (let i = 1; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
    }
  });

  it('calculateMaxInputTokens: finite, non-negative, grows with the window', () => {
    const room = [...smallWindows, ...largeWindows].map((w) => calculateMaxInputTokens(w, 'fixed', 800)!);
    for (const r of room) {
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < room.length; i++) {
      expect(room[i]).toBeGreaterThanOrEqual(room[i - 1]);
    }
  });

  it('calculateMaxItems: finite, non-negative, grows with the window (capped by per-item math)', () => {
    const n = [...smallWindows, ...largeWindows].map((w) => calculateMaxItems(w, '', 60, 15)!);
    for (const count of n) {
      expect(Number.isFinite(count)).toBe(true);
      expect(count).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < n.length; i++) {
      expect(n[i]).toBeGreaterThanOrEqual(n[i - 1]);
    }
  });
});

describe('shared token estimation', () => {
  it('exports CHARS_PER_TOKEN = 2.3', () => {
    expect(CHARS_PER_TOKEN).toBe(2.3);
  });

  it('estimateTokens uses the CHARS_PER_TOKEN ratio (not /4)', () => {
    // 23 chars / 2.3 = 10 tokens exactly
    expect(estimateTokens('a'.repeat(23))).toBe(10);
    // 8 chars / 2.3 = 3.48 → ceil → 4 (would be 2 under /4)
    expect(estimateTokens('abcdefgh')).toBe(4);
    expect(estimateTokens('')).toBe(0);
  });
});
