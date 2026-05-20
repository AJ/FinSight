import { getClient } from '@/lib/llm/index';
import type { LLMProvider } from '@/lib/llm/types';
import { getContextWindowInfo } from '@/lib/llm/contextWindow';
import type { Currency } from '@/types';
import type { Insight, InsightType, InsightSeverity, TransactionAnalytics } from './types';
import { buildInsightsPrompt, parseInsightsResponse } from './prompts';

const VALID_INSIGHT_TYPES = new Set<string>([
  'category_trend', 'day_pattern', 'merchant_insight',
  'anomaly', 'budget_alert', 'period_comparison', 'savings_opportunity',
]);

const VALID_SEVERITIES = new Set<string>(['info', 'warning', 'positive']);

function validateInsightType(value: string | undefined): InsightType {
  return value && VALID_INSIGHT_TYPES.has(value) ? value as InsightType : 'category_trend';
}

function validateInsightSeverity(value: string | undefined): InsightSeverity {
  return value && VALID_SEVERITIES.has(value) ? value as InsightSeverity : 'info';
}

export interface GenerateInsightsOptions {
  analytics: TransactionAnalytics;
  currency: Currency;
  provider: LLMProvider;
  baseUrl: string;
  model?: string;
}

export async function generateInsights(options: GenerateInsightsOptions): Promise<Insight[]> {
  const { analytics, currency, provider, baseUrl, model } = options;

  if (!model?.trim()) {
    throw new Error('Insights generation requires a model. Configure a model in settings.');
  }

  const prompt = buildInsightsPrompt(analytics, currency);
  const client = getClient(provider);

  const contextInfo = await getContextWindowInfo({
    provider,
    baseUrl,
    model,
  });

  const estimatedPromptTokens = Math.ceil(prompt.length / 4);
  // Insights output should be concise — cap at 2000 tokens even though the
  // pipeline deliberately omits maxTokens to let the server use remaining context.
  const reserveTokens = 2000;
  const maxTokens = contextInfo.contextLength
    ? Math.min(reserveTokens, contextInfo.contextLength - estimatedPromptTokens)
    : undefined;

  const response = await client.generate(baseUrl, model, prompt, {
    temperature: 0.05,
    stage: 'insights',
    maxTokens: maxTokens && maxTokens > 0 ? maxTokens : undefined,
  });

  const parsed = parseInsightsResponse(response);

  return parsed.insights.map((insight, index): Insight => ({
    id: `insight-${Date.now()}-${index}`,
    type: validateInsightType(insight.type),
    title: insight.title || 'Insight',
    description: insight.description || '',
    severity: validateInsightSeverity(insight.severity),
    category: insight.category,
  }));
}
