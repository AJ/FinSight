import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getClient } from '@/lib/llm/index';

vi.mock('@/lib/llm/index', () => ({
  getClient: vi.fn(),
}));

vi.mock('@/lib/insights/prompts', () => ({
  buildInsightsPrompt: vi.fn().mockReturnValue('mock prompt'),
  parseInsightsResponse: vi.fn(),
}));

import { generateInsights } from '@/lib/insights/browserGenerator';
import { parseInsightsResponse } from '@/lib/insights/prompts';
import type { TransactionAnalytics } from '@/lib/insights/types';

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

beforeEach(() => {
  vi.clearAllMocks();
});

function mockGenerate(returnValue: string) {
  return vi.fn().mockResolvedValue(returnValue);
}

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

  it('calls client.generate with correct parameters', async () => {
    const generate = mockGenerate('{"insights":[]}');
    vi.mocked(getClient).mockReturnValue({ generate } as never);
    vi.mocked(parseInsightsResponse).mockReturnValue({ insights: [] });

    await generateInsights(baseOptions);

    expect(getClient).toHaveBeenCalledWith('ollama');
    expect(generate).toHaveBeenCalledWith(
      'http://localhost:11434',
      'llama3',
      'mock prompt',
      { temperature: 0.05, stage: 'insights' },
    );
  });

  it('returns mapped insights with generated IDs', async () => {
    const generate = mockGenerate('response');
    vi.mocked(getClient).mockReturnValue({ generate } as never);
    vi.mocked(parseInsightsResponse).mockReturnValue({
      insights: [
        { type: 'category_trend', title: 'Spending Up', description: 'Spending increased', severity: 'warning', category: 'food' },
        { type: 'anomaly', title: 'Unusual Charge', description: 'Large transaction', severity: 'info' },
      ],
    });

    const result = await generateInsights(baseOptions);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('category_trend');
    expect(result[0].title).toBe('Spending Up');
    expect(result[0].category).toBe('food');
    expect(result[0].id).toMatch(/^insight-\d+-0$/);
    expect(result[1].type).toBe('anomaly');
    expect(result[1].category).toBeUndefined();
  });

  it('defaults title to "Insight" when missing', async () => {
    const generate = mockGenerate('response');
    vi.mocked(getClient).mockReturnValue({ generate } as never);
    vi.mocked(parseInsightsResponse).mockReturnValue({
      insights: [{ type: 'anomaly', title: '', description: 'desc', severity: 'info' }],
    });

    const result = await generateInsights(baseOptions);

    expect(result[0].title).toBe('Insight');
  });

  it('defaults description to empty string when missing', async () => {
    const generate = mockGenerate('response');
    vi.mocked(getClient).mockReturnValue({ generate } as never);
    vi.mocked(parseInsightsResponse).mockReturnValue({
      insights: [{ type: 'anomaly', title: 'Title', description: '', severity: 'info' }],
    });

    const result = await generateInsights(baseOptions);

    expect(result[0].description).toBe('');
  });

  it('falls back to category_trend for invalid InsightType', async () => {
    const generate = mockGenerate('response');
    vi.mocked(getClient).mockReturnValue({ generate } as never);
    vi.mocked(parseInsightsResponse).mockReturnValue({
      insights: [{ type: 'totally_invalid_type', title: 'T', description: 'D', severity: 'info' }],
    });

    const result = await generateInsights(baseOptions);

    expect(result[0].type).toBe('category_trend');
  });

  it('falls back to category_trend for undefined type', async () => {
    const generate = mockGenerate('response');
    vi.mocked(getClient).mockReturnValue({ generate } as never);
    vi.mocked(parseInsightsResponse).mockReturnValue({
      insights: [{ title: 'T', description: 'D', severity: 'info' }],
    });

    const result = await generateInsights(baseOptions);

    expect(result[0].type).toBe('category_trend');
  });

  it('accepts all valid InsightType values', async () => {
    const validTypes = ['category_trend', 'day_pattern', 'merchant_insight', 'anomaly', 'budget_alert', 'period_comparison', 'savings_opportunity'];
    const generate = mockGenerate('response');
    vi.mocked(getClient).mockReturnValue({ generate } as never);

    for (const type of validTypes) {
      vi.mocked(parseInsightsResponse).mockReturnValue({
        insights: [{ type, title: 'T', description: 'D', severity: 'info' }],
      });

      const result = await generateInsights(baseOptions);
      expect(result[0].type).toBe(type);
    }
  });

  it('falls back to info for invalid InsightSeverity', async () => {
    const generate = mockGenerate('response');
    vi.mocked(getClient).mockReturnValue({ generate } as never);
    vi.mocked(parseInsightsResponse).mockReturnValue({
      insights: [{ type: 'anomaly', title: 'T', description: 'D', severity: 'critical' }],
    });

    const result = await generateInsights(baseOptions);

    expect(result[0].severity).toBe('info');
  });

  it('falls back to info for undefined severity', async () => {
    const generate = mockGenerate('response');
    vi.mocked(getClient).mockReturnValue({ generate } as never);
    vi.mocked(parseInsightsResponse).mockReturnValue({
      insights: [{ type: 'anomaly', title: 'T', description: 'D' }],
    });

    const result = await generateInsights(baseOptions);

    expect(result[0].severity).toBe('info');
  });

  it('accepts all valid InsightSeverity values', async () => {
    const validSeverities = ['info', 'warning', 'positive'];
    const generate = mockGenerate('response');
    vi.mocked(getClient).mockReturnValue({ generate } as never);

    for (const severity of validSeverities) {
      vi.mocked(parseInsightsResponse).mockReturnValue({
        insights: [{ type: 'anomaly', title: 'T', description: 'D', severity }],
      });

      const result = await generateInsights(baseOptions);
      expect(result[0].severity).toBe(severity);
    }
  });

  it('propagates generate errors', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('Connection refused'));
    vi.mocked(getClient).mockReturnValue({ generate } as never);

    await expect(generateInsights(baseOptions)).rejects.toThrow('Connection refused');
  });
});
