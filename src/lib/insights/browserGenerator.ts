import { getClient } from '@/lib/llm/index';
import { LLMError } from '@/lib/llm/types';
import type { LLMProvider } from '@/lib/llm/types';
import { getContextWindowInfo, calculateMaxOutputTokens, overflowKind } from '@/lib/llm/contextWindow';
import { EXTRACTION_SYSTEM_PROMPT } from '@/lib/llm/prompts';
import type { Currency } from '@/types';
import type { Insight, InsightType, InsightSeverity, TransactionAnalytics } from './types';
import { buildInsightsPrompt, parseInsightsResponse, INSIGHTS_SCHEMA } from './prompts';

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

  // Unified context-aware budget on the full input actually sent (system prompt + insights
  // prompt). The 2000 cap preserves the "insights should be concise" design goal — the model
  // rarely needs more. On tight budgets it produces fewer insights (graceful degradation).
  const computedMaxTokens = calculateMaxOutputTokens(
    contextInfo.contextLength,
    `${EXTRACTION_SYSTEM_PROMPT}\n\n${prompt}`,
  );
  if (computedMaxTokens === 0) {
    throw new LLMError(
      "Insights prompt exceeds the model's context window.",
      overflowKind(contextInfo.contextLength),
    );
  }
  const maxOutputTokens = computedMaxTokens ? Math.min(2000, computedMaxTokens) : undefined;

  const response = await client.generate(baseUrl, model, prompt, {
    temperature: 0.05,
    stage: 'insights',
    maxOutputTokens,
    contextWindow: contextInfo.contextLength,
    responseFormat: 'json',
    responseSchema: INSIGHTS_SCHEMA,
    schemaName: 'insights',
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
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
