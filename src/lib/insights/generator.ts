/**
 * LLM-based insight generator.
 * Calls the LLM with pre-aggregated analytics to generate spending insights.
 */

import { getBrowserClient } from '@/lib/llm/index';
import { Insight, InsightsGenerationOptions, TransactionAnalytics } from './types';
import { buildInsightsPrompt, parseInsightsResponse } from './prompts';
import { Currency } from '@/types';

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

  console.log('[Insights] ========== GENERATION START ==========');
  console.log('[Insights] Currency:', currency);
  console.log('[Insights] Provider:', options.provider);
  console.log('[Insights] Model:', options.model);
  console.log('[Insights] Base URL:', options.baseUrl);
  console.log('[Insights] PROMPT:');
  console.log(prompt);
  console.log('[Insights] =======================================');

  try {
    // Use low temperature for consistent JSON output
    const response = await client.generate(
      options.baseUrl,
      options.model,
      prompt,
      { temperature: 0.3 }
    );

    console.log('[Insights] ========== LLM RESPONSE ==========');
    console.log('[Insights] Response length:', response.length);
    console.log('[Insights] Full response:');
    console.log(response);
    console.log('[Insights] ===================================');

    const parsed = parseInsightsResponse(response);

    console.log('[Insights] Parsed insights count:', parsed.insights.length);
    console.log('[Insights] Parsed insights:', JSON.stringify(parsed.insights, null, 2));

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

    console.log('[Insights] ========== GENERATION COMPLETE ==========');

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
