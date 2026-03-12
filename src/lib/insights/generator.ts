/**
 * LLM-based insight generator.
 * Calls the LLM with pre-aggregated analytics to generate spending insights.
 */

import { getBrowserClient } from '@/lib/llm/index';
import { Insight, InsightsGenerationOptions, TransactionAnalytics } from './types';
import { buildInsightsPrompt, parseInsightsResponse } from './prompts';
import { Currency } from '@/types';
import { debugLog, debugSensitive } from '@/lib/utils/debug';

/**
 * Generate spending insights from transaction analytics.
 */
export async function generateInsights(
  analytics: TransactionAnalytics,
  options: InsightsGenerationOptions
): Promise<Insight[]> {
  const client = getBrowserClient(options.provider);
  const currency: Currency = options.currency || { code: 'USD', symbol: '$', name: 'US Dollar' };
  const prompt = buildInsightsPrompt(analytics, currency);

  debugLog('[Insights] ========== GENERATION START ==========');
  debugLog('[Insights] Currency:', currency);
  debugLog('[Insights] Provider:', options.provider);
  debugLog('[Insights] Model:', options.model);
  debugLog('[Insights] Base URL:', options.baseUrl);
  debugSensitive('Insights PROMPT', prompt);
  debugLog('[Insights] =======================================');

  try {
    // Use low temperature for consistent JSON output
    const response = await client.generate(
      options.baseUrl,
      options.model,
      prompt,
      { temperature: 0.05 }
    );

    debugLog('[Insights] ========== LLM RESPONSE ==========');
    debugLog('[Insights] Response length:', response.length);
    debugSensitive('Insights Full response', response);
    debugLog('[Insights] ===================================');

    const parsed = parseInsightsResponse(response);

    debugLog('[Insights] Parsed insights count:', parsed.insights.length);
    debugSensitive('Insights Parsed', parsed.insights);

    // Add unique IDs to each insight
    const insights: Insight[] = parsed.insights.map((insight, index) => ({
      id: `insight-${Date.now()}-${index}`,
      type: insight.type as Insight['type'],
      title: insight.title,
      description: insight.description,
      severity: insight.severity as Insight['severity'],
      category: insight.category,
      data: insight.data,
    }));

    debugLog('[Insights] ========== GENERATION COMPLETE ==========');

    return insights;
  } catch (error) {
    console.error('[Insights] ========== GENERATION FAILED ==========');
    console.error('[Insights] Error:', error);
    throw new Error(
      error instanceof Error
        ? `Failed to generate insights: ${error.message}`
        : 'Failed to generate insights'
    );
  }
}
