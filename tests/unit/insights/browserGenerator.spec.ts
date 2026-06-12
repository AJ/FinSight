import { describe, it, expect, vi, beforeEach } from 'vitest';

import { generateInsights } from '@/lib/insights/browserGenerator';
import type { TransactionAnalytics } from '@/lib/insights/types';

// Mock fetch — the only external boundary (LLM HTTP calls go through here)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock getContextWindowInfo so no listModels fetch call is needed
const mockGetContextWindowInfo = vi.fn();
vi.mock('@/lib/llm/contextWindow', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/llm/contextWindow')>();
  return {
    ...original,
    getContextWindowInfo: (...args: unknown[]) => mockGetContextWindowInfo(...args),
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────────

const mockAnalytics: TransactionAnalytics = {
  byMonth: {},
  byCategory: {},
  byCategoryByMonth: {},
  byDayOfWeek: {},
  currentMonth: { income: 0, expenses: 0 },
  previousMonth: { income: 0, expenses: 0 },
  threeMonthAvg: { income: 0, expenses: 0 },
  topMerchants: [],
  topCategories: [],
  anomalies: [],
  totalTransactions: 0,
  dateRange: { start: '2024-01-01', end: '2024-01-31' },
};

const baseOptions = {
  analytics: mockAnalytics,
  currency: { code: 'USD', symbol: '$', name: 'US Dollar' },
  provider: 'ollama' as const,
  baseUrl: 'http://localhost:11434',
  model: 'llama3',
};

function insightsResponse(insightsJson: object) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      response: JSON.stringify(insightsJson),
      prompt_eval_count: 10,
      eval_count: 20,
    }),
    text: () => Promise.resolve(JSON.stringify({ response: JSON.stringify(insightsJson) })),
  });
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();

  // Default: context window unknown — no maxTokens passed to generate
  mockGetContextWindowInfo.mockResolvedValue({
    contextLength: undefined,
    source: 'listModels_fallback',
    provider: 'ollama',
    modelId: 'llama3',
  });
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('generateInsights', () => {
  it('throws if no model is configured', async () => {
    await expect(generateInsights({ ...baseOptions, model: undefined }))
      .rejects.toThrow('Insights generation requires a model');
  });

  it('throws if model is empty string', async () => {
    await expect(generateInsights({ ...baseOptions, model: '' }))
      .rejects.toThrow('Insights generation requires a model');
  });

  it('throws if model is whitespace', async () => {
    await expect(generateInsights({ ...baseOptions, model: '   ' }))
      .rejects.toThrow('Insights generation requires a model');
  });

  it('calls LLM with correct endpoint and parameters', async () => {
    mockFetch.mockResolvedValue(insightsResponse({ insights: [] }));

    await generateInsights(baseOptions);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/generate',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('llama3');
    expect(body.options.temperature).toBe(0.05);
  });

  it('returns mapped insights with generated IDs', async () => {
    mockFetch.mockResolvedValue(insightsResponse({
      insights: [
        { type: 'category_trend', title: 'Spending Up', description: 'Spending increased', severity: 'warning', category: 'shopping' },
        { type: 'anomaly', title: 'Unusual Charge', description: 'Large transaction', severity: 'info' },
      ],
    }));

    const result = await generateInsights(baseOptions);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('category_trend');
    expect(result[0].title).toBe('Spending Up');
    expect(result[0].category).toBe('shopping');
    expect(result[0].id).toMatch(/^insight-\d+-0$/);
    expect(result[1].type).toBe('anomaly');
    expect(result[1].category).toBeUndefined();
  });

  it('defaults title via normalizeInsight when missing', async () => {
    // normalizeInsight defaults empty title to 'Spending Insight'
    mockFetch.mockResolvedValue(insightsResponse({
      insights: [{ type: 'anomaly', title: '', description: 'desc', severity: 'info' }],
    }));

    const result = await generateInsights(baseOptions);

    expect(result[0].title).toBe('Spending Insight');
  });

  it('defaults description to empty string when missing', async () => {
    mockFetch.mockResolvedValue(insightsResponse({
      insights: [{ type: 'anomaly', title: 'Title', description: '', severity: 'info' }],
    }));

    const result = await generateInsights(baseOptions);

    expect(result[0].description).toBe('');
  });

  it('falls back to category_trend for invalid InsightType', async () => {
    // normalizeInsight converts invalid type to 'category_trend' before browserGenerator validates
    mockFetch.mockResolvedValue(insightsResponse({
      insights: [{ type: 'totally_invalid_type', title: 'T', description: 'D', severity: 'info' }],
    }));

    const result = await generateInsights(baseOptions);

    expect(result[0].type).toBe('category_trend');
  });

  it('falls back to category_trend for undefined type', async () => {
    // JSON without type field → normalizeInsight sees undefined → defaults to category_trend
    mockFetch.mockResolvedValue(insightsResponse({
      insights: [{ title: 'T', description: 'D', severity: 'info' }],
    }));

    const result = await generateInsights(baseOptions);

    expect(result[0].type).toBe('category_trend');
  });

  it('accepts all valid InsightType values', async () => {
    const validTypes = ['category_trend', 'day_pattern', 'merchant_insight', 'anomaly', 'budget_alert', 'period_comparison', 'savings_opportunity'];

    for (const type of validTypes) {
      mockFetch.mockResolvedValue(insightsResponse({
        insights: [{ type, title: 'T', description: 'D', severity: 'info' }],
      }));

      const result = await generateInsights(baseOptions);
      expect(result[0].type).toBe(type);
    }
  });

  it('falls back to info for invalid InsightSeverity', async () => {
    mockFetch.mockResolvedValue(insightsResponse({
      insights: [{ type: 'anomaly', title: 'T', description: 'D', severity: 'critical' }],
    }));

    const result = await generateInsights(baseOptions);

    expect(result[0].severity).toBe('info');
  });

  it('falls back to info for undefined severity', async () => {
    mockFetch.mockResolvedValue(insightsResponse({
      insights: [{ type: 'anomaly', title: 'T', description: 'D' }],
    }));

    const result = await generateInsights(baseOptions);

    expect(result[0].severity).toBe('info');
  });

  it('accepts all valid InsightSeverity values', async () => {
    const validSeverities = ['info', 'warning', 'positive'];

    for (const severity of validSeverities) {
      mockFetch.mockResolvedValue(insightsResponse({
        insights: [{ type: 'anomaly', title: 'T', description: 'D', severity }],
      }));

      const result = await generateInsights(baseOptions);
      expect(result[0].severity).toBe(severity);
    }
  });

  it('propagates LLM errors', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    await expect(generateInsights(baseOptions)).rejects.toThrow();
  });

  // ── Context-aware token budgeting ──────────────────────────────────────────

  it('passes correct maxTokens based on context window minus prompt estimate', async () => {
    mockFetch.mockResolvedValue(insightsResponse({ insights: [] }));
    mockGetContextWindowInfo.mockResolvedValue({
      contextLength: 8192,
      source: 'settings_cache',
      provider: 'ollama',
      modelId: 'llama3',
    });

    await generateInsights(baseOptions);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const prompt = body.prompt as string;
    const estimatedPromptTokens = Math.ceil(prompt.length / 4);
    const expectedMaxTokens = Math.min(2000, 8192 - estimatedPromptTokens);
    // Verify the exact formula: min(2000, contextLength - promptTokens)
    expect(body.options.num_predict).toBe(expectedMaxTokens);
  });

  it('omits maxTokens when context window is unknown', async () => {
    mockFetch.mockResolvedValue(insightsResponse({ insights: [] }));
    // default mock returns contextLength: undefined

    await generateInsights(baseOptions);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.num_predict).toBeUndefined();
  });

  it('omits maxTokens when prompt exceeds context window', async () => {
    mockFetch.mockResolvedValue(insightsResponse({ insights: [] }));
    mockGetContextWindowInfo.mockResolvedValue({
      contextLength: 100, // very small — prompt will exceed it
      source: 'listModels_fallback',
      provider: 'ollama',
      modelId: 'llama3',
    });

    await generateInsights(baseOptions);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.num_predict).toBeUndefined();
  });

  it('calls getContextWindowInfo with correct parameters', async () => {
    mockFetch.mockResolvedValue(insightsResponse({ insights: [] }));

    await generateInsights(baseOptions);

    expect(mockGetContextWindowInfo).toHaveBeenCalledWith({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    });
  });
});
