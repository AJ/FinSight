import { describe, it, expect } from 'vitest';

import {
  getInsightSystemPrompt,
  buildInsightsPrompt,
  parseInsightsResponse,
  INSIGHTS_SCHEMA,
} from '@/lib/insights/prompts';
import type { TransactionAnalytics } from '@/lib/insights/types';

function makeAnalytics(overrides: Partial<TransactionAnalytics> = {}): TransactionAnalytics {
  return {
    byMonth: { '2024-01': { income: 50000, expenses: 30000 } },
    byCategory: {},
    byCategoryByMonth: {},
    byDayOfWeek: { 0: { total: 5000, count: 3 } },
    currentMonth: { income: 50000, expenses: 30000 },
    previousMonth: { income: 45000, expenses: 28000 },
    threeMonthAvg: { income: 47000, expenses: 29000 },
    topMerchants: [{ name: 'Amazon', total: 5000, count: 5 }],
    topCategories: [{ category: 'shopping', total: 5000, percentage: 16.7 }],
    anomalies: [{ description: 'Large Amazon purchase', amount: 5000, zScore: 2.5 }],
    totalTransactions: 50,
    dateRange: { start: '2024-01-01', end: '2024-01-31' },
    ...overrides,
  };
}

describe('getInsightSystemPrompt', () => {
  it('includes the currency symbol', () => {
    const prompt = getInsightSystemPrompt('₹');
    expect(prompt).toContain('₹');
  });

  it('includes rules about not restating data', () => {
    const prompt = getInsightSystemPrompt('$');
    expect(prompt).toContain('DO NOT just restate the data');
  });

  it('includes transfer exclusion rule', () => {
    const prompt = getInsightSystemPrompt('$');
    expect(prompt).toContain('Transfer');
    expect(prompt).toContain('not spending');
  });

  it('includes JSON output format instruction', () => {
    const prompt = getInsightSystemPrompt('$');
    expect(prompt).toContain('"insights"');
    expect(prompt).toContain('JSON');
  });

  it('uses different currency symbols correctly', () => {
    const euroPrompt = getInsightSystemPrompt('€');
    expect(euroPrompt).toContain('€');
    expect(euroPrompt).not.toContain('₹');
  });
});

describe('buildInsightsPrompt', () => {
  const currency = { code: 'INR', symbol: '₹', name: 'Indian Rupee' };

  it('includes currency symbol in output', () => {
    const prompt = buildInsightsPrompt(makeAnalytics(), currency);
    expect(prompt).toContain('₹');
  });

  it('includes top categories in output', () => {
    const analytics = makeAnalytics({
      topCategories: [
        { category: 'groceries', total: 8000, percentage: 26.7 },
        { category: 'shopping', total: 5000, percentage: 16.7 },
      ],
    });
    const prompt = buildInsightsPrompt(analytics, currency);
    expect(prompt).toContain('groceries');
    expect(prompt).toContain('shopping');
  });

  it('filters out transfer and income from top categories', () => {
    const analytics = makeAnalytics({
      topCategories: [
        { category: 'groceries', total: 8000, percentage: 26.7 },
        { category: 'transfer', total: 20000, percentage: 66.7 },
        { category: 'income', total: 50000, percentage: 100 },
      ],
    });
    const prompt = buildInsightsPrompt(analytics, currency);
    // The "SPENDING CATEGORIES (excluding income and transfers)" header contains those words,
    // so split further to get just the actual category list lines
    const categoriesSection = prompt.split('=== SPENDING CATEGORIES')[1]?.split('=== MONTHLY TRENDS')[0] ?? '';
    const categoryLines = categoriesSection.split('\n').filter(line => line.includes('₹'));
    const categoryNames = categoryLines.map(l => l.split(':')[0].trim());
    expect(categoryNames).toContain('groceries');
    expect(categoryNames).not.toContain('transfer');
    expect(categoryNames).not.toContain('income');
  });

  it('includes anomalies when present', () => {
    const analytics = makeAnalytics({
      anomalies: [{ description: 'Huge purchase', amount: 25000, zScore: 3.1 }],
    });
    const prompt = buildInsightsPrompt(analytics, currency);
    expect(prompt).toContain('LARGE TRANSACTIONS');
    expect(prompt).toContain('Huge purchase');
  });

  it('does not include LARGE TRANSACTIONS when no anomalies', () => {
    const analytics = makeAnalytics({ anomalies: [] });
    const prompt = buildInsightsPrompt(analytics, currency);
    expect(prompt).not.toContain('LARGE TRANSACTIONS');
  });

  it('includes monthly trend data', () => {
    const analytics = makeAnalytics({
      byMonth: {
        '2023-11': { income: 40000, expenses: 25000 },
        '2023-12': { income: 45000, expenses: 28000 },
        '2024-01': { income: 50000, expenses: 30000 },
      },
    });
    const prompt = buildInsightsPrompt(analytics, currency);
    expect(prompt).toContain('MONTHLY TRENDS');
    expect(prompt).toContain('2024-01');
  });

  it('includes day-of-week data', () => {
    const analytics = makeAnalytics({
      byDayOfWeek: {
        0: { total: 5000, count: 3 },
        5: { total: 12000, count: 8 },
      },
    });
    const prompt = buildInsightsPrompt(analytics, currency);
    // JS day 5 = Friday, day 0 = Sunday
    expect(prompt).toContain('Friday');
    expect(prompt).toContain('Sunday');
  });

  it('handles empty analytics gracefully', () => {
    const analytics = makeAnalytics({
      byMonth: {},
      topCategories: [],
      topMerchants: [],
      anomalies: [],
      byDayOfWeek: {},
      dateRange: { start: '', end: '' },
    });
    const prompt = buildInsightsPrompt(analytics, currency);
    expect(prompt).toContain('FINANCIAL SUMMARY');
    expect(prompt).toContain('No expense categories');
  });

  it('includes transfer info when byCategory has transfers', () => {
    const analytics = makeAnalytics({
      byCategory: { transfer: { total: 20000, count: 5, avg: 4000 } },
    });
    const prompt = buildInsightsPrompt(analytics, currency);
    expect(prompt).toContain('transfers');
  });

  it('computes savings rate from latest month', () => {
    const analytics = makeAnalytics({
      byMonth: {
        '2024-01': { income: 100000, expenses: 70000 },
      },
    });
    const prompt = buildInsightsPrompt(analytics, currency);
    // Savings rate = (100000-70000)/100000 * 100 = 30.0%
    expect(prompt).toContain('30.0');
  });

  it('shows 0% savings rate when income is zero', () => {
    const analytics = makeAnalytics({
      byMonth: { '2024-01': { income: 0, expenses: 5000 } },
    });
    const prompt = buildInsightsPrompt(analytics, currency);
    // When income=0, code returns '0' → "0%"
    expect(prompt).toContain('0%');
  });
});

describe('parseInsightsResponse', () => {
  it('parses direct JSON response', () => {
    const response = JSON.stringify({
      insights: [
        { type: 'category_trend', title: 'Test', description: 'Desc', severity: 'warning' },
      ],
    });
    const result = parseInsightsResponse(response);
    expect(result.insights).toHaveLength(1);
    expect(result.insights[0].title).toBe('Test');
  });

  it('parses JSON wrapped in markdown code block', () => {
    const response = '```json\n{"insights":[{"type":"anomaly","title":"Alert","description":"Desc","severity":"positive"}]}\n```';
    const result = parseInsightsResponse(response);
    expect(result.insights).toHaveLength(1);
    expect(result.insights[0].type).toBe('anomaly');
  });

  it('parses JSON from code block without language tag', () => {
    const response = '```\n{"insights":[{"type":"day_pattern","title":"Test","description":"Desc","severity":"info"}]}\n```';
    const result = parseInsightsResponse(response);
    expect(result.insights).toHaveLength(1);
  });

  it('extracts embedded JSON from surrounding text', () => {
    const response = `Here are your insights:
{"insights":[{"type":"savings_opportunity","title":"Save","description":"You can save","severity":"positive","category":"groceries"}]}
Hope that helps!`;
    const result = parseInsightsResponse(response);
    expect(result.insights).toHaveLength(1);
    expect(result.insights[0].category).toBe('groceries');
  });

  it('throws for a completely unparseable response (surfaces to caller, spec §9)', () => {
    expect(() => parseInsightsResponse('This is not JSON at all')).toThrow(
      'Insights response was not valid JSON and could not be parsed.',
    );
  });

  it('throws for an empty string', () => {
    expect(() => parseInsightsResponse('')).toThrow(
      'Insights response was not valid JSON and could not be parsed.',
    );
  });

  it('normalizes invalid type to category_trend', () => {
    const response = JSON.stringify({
      insights: [{ type: 'invalid_type', title: 'Test', description: 'Desc', severity: 'info' }],
    });
    const result = parseInsightsResponse(response);
    expect(result.insights[0].type).toBe('category_trend');
  });

  it('normalizes invalid severity to info', () => {
    const response = JSON.stringify({
      insights: [{ type: 'category_trend', title: 'Test', description: 'Desc', severity: 'critical' }],
    });
    const result = parseInsightsResponse(response);
    expect(result.insights[0].severity).toBe('info');
  });

  it('defaults missing title to "Spending Insight"', () => {
    const response = JSON.stringify({
      insights: [{ type: 'category_trend', description: 'Desc', severity: 'info' }],
    });
    const result = parseInsightsResponse(response);
    expect(result.insights[0].title).toBe('Spending Insight');
  });

  it('defaults missing description to empty string', () => {
    const response = JSON.stringify({
      insights: [{ type: 'category_trend', title: 'Test', severity: 'info' }],
    });
    const result = parseInsightsResponse(response);
    expect(result.insights[0].description).toBe('');
  });

  it('preserves valid insight types', () => {
    const validTypes = [
      'category_trend', 'day_pattern', 'merchant_insight', 'anomaly',
      'budget_alert', 'period_comparison', 'savings_opportunity',
    ];
    for (const type of validTypes) {
      const response = JSON.stringify({
        insights: [{ type, title: 'T', description: 'D', severity: 'info' }],
      });
      const result = parseInsightsResponse(response);
      expect(result.insights[0].type).toBe(type);
    }
  });

  it('preserves valid severities', () => {
    for (const severity of ['info', 'warning', 'positive']) {
      const response = JSON.stringify({
        insights: [{ type: 'category_trend', title: 'T', description: 'D', severity }],
      });
      const result = parseInsightsResponse(response);
      expect(result.insights[0].severity).toBe(severity);
    }
  });

  it('strips category when empty string', () => {
    const response = JSON.stringify({
      insights: [{ type: 'category_trend', title: 'T', description: 'D', severity: 'info', category: '' }],
    });
    const result = parseInsightsResponse(response);
    expect(result.insights[0].category).toBeUndefined();
  });

  it('preserves data object when present', () => {
    const response = JSON.stringify({
      insights: [{
        type: 'category_trend', title: 'T', description: 'D', severity: 'info',
        data: { amount: 5000, change: -10 },
      }],
    });
    const result = parseInsightsResponse(response);
    expect(result.insights[0].data).toEqual({ amount: 5000, change: -10 });
  });

  it('throws when insights is present but not an array (total parse failure)', () => {
    const response = JSON.stringify({ insights: 'not an array' });
    expect(() => parseInsightsResponse(response)).toThrow(
      'Insights response was not valid JSON and could not be parsed.',
    );
  });

  it('handles multiple insights in one response', () => {
    const response = JSON.stringify({
      insights: [
        { type: 'category_trend', title: 'First', description: 'D1', severity: 'warning' },
        { type: 'anomaly', title: 'Second', description: 'D2', severity: 'positive' },
        { type: 'day_pattern', title: 'Third', description: 'D3', severity: 'info' },
      ],
    });
    const result = parseInsightsResponse(response);
    expect(result.insights).toHaveLength(3);
  });
});

describe('INSIGHTS_SCHEMA', () => {
  it('requires insights array; items constrain type + severity', () => {
    expect(INSIGHTS_SCHEMA.required).toEqual(['insights']);
    const item = INSIGHTS_SCHEMA.properties?.insights?.items;
    expect(item?.properties?.type?.enum).toEqual([
      'category_trend', 'day_pattern', 'merchant_insight', 'anomaly',
      'budget_alert', 'period_comparison', 'savings_opportunity',
    ]);
    expect(item?.properties?.severity?.enum).toEqual(['info', 'warning', 'positive']);
    expect(item?.required).toEqual(['type', 'title', 'description', 'severity']);
    expect(item?.additionalProperties).toBe(true);
  });
});

describe('insights prompt skeleton (restored)', () => {
  it('system prompt embeds the JSON skeleton + "Output ONLY" boilerplate', () => {
    const p = getInsightSystemPrompt('$');
    expect(p).toContain('Output ONLY valid JSON');
    expect(p).toContain('{"insights":');
  });

  it('user prompt ends with the "Return ONLY the JSON object" boilerplate', () => {
    const p = buildInsightsPrompt(makeAnalytics(), { code: 'INR', symbol: '₹', name: 'Indian Rupee' });
    expect(p).toContain('Return ONLY the JSON object');
  });
});
