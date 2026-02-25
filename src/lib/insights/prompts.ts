/**
 * LLM prompts for generating spending insights.
 */

import { TransactionAnalytics } from './types';
import { Currency } from '@/types';

export function getInsightSystemPrompt(currencySymbol: string): string {
  return `You are a financial advisor analyzing spending data. Generate 4-6 MEANINGFUL insights that help the user understand their financial health and take action.

DO NOT just restate the data. Instead, provide INTERPRETATION and ADVICE.

Example of BAD insights (DO NOT DO THIS):
- "Monday saw ${currencySymbol}63,336 in spending" - this is just restating data
- "HDFC transaction of ${currencySymbol}58,000 is large" - obvious observation

Example of GOOD insights:
- "Your spending is heavily concentrated in transfers (93% of expenses). Consider if all transfers are necessary or if some could be delayed."
- "You received ${currencySymbol}95,397 income but spent ${currencySymbol}143,760 - a deficit of ${currencySymbol}48,363. This pattern is unsustainable long-term."
- "Large IMPS transfers suggest you may be moving money between accounts. Track these to ensure they're not forgotten expenses."

RULES:
1. Focus on PATTERNS and TRENDS, not individual transactions
2. Provide ACTIONABLE advice - what should the user DO?
3. Calculate meaningful ratios: savings rate, expense-to-income ratio, category concentration
4. Use ${currencySymbol} currency symbol (not $)
5. Keep titles short (3-5 words), descriptions 1-2 sentences

CATEGORY FIELD:
- Only include if insight is about a specific category
- Valid values: groceries, dining, transportation, utilities, housing, healthcare, entertainment, shopping, income, interest, transfer, bills, investment, insurance, education, travel, other

SEVERITY:
- "positive": Good financial news
- "warning": Concerns that need attention
- "info": Neutral but useful observation

Output ONLY valid JSON:
{"insights":[{"type":"category_trend","title":"...","description":"...","severity":"warning","category":"transfer"}]}

No markdown code blocks. Only the JSON object.`;
}

/**
 * Build the user prompt with pre-aggregated analytics data.
 */
export function buildInsightsPrompt(analytics: TransactionAnalytics, currency: Currency): string {
  const symbol = currency.symbol;
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Format day-of-week data
  const dayOfWeekSummary = Object.entries(analytics.byDayOfWeek)
    .map(([day, data]) => `${dayNames[Number(day)]}: ${symbol}${data.total.toFixed(0)} (${data.count} transactions)`)
    .join('\n');

  // Format top categories
  const topCategoriesSummary = analytics.topCategories
    .map((c) => `${c.category}: ${symbol}${c.total.toFixed(0)} (${c.percentage}%)`)
    .join('\n');

  // Format top merchants
  const topMerchantsSummary = analytics.topMerchants
    .map((m) => `${m.name}: ${symbol}${m.total.toFixed(0)} (${m.count} transactions)`)
    .join('\n');

  // Format anomalies
  const anomaliesSummary = analytics.anomalies.length > 0
    ? analytics.anomalies.map((a) => `${a.description}: ${symbol}${a.amount.toFixed(0)} (z-score: ${a.zScore})`).join('\n')
    : 'None detected';

  // Format monthly data (last 6 months)
  const recentMonths = Object.entries(analytics.byMonth)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6)
    .map(([month, data]) => `${month}: Income ${symbol}${data.income.toFixed(0)}, Expenses ${symbol}${data.expenses.toFixed(0)}`)
    .join('\n');

  // Format category trends by month (for top categories)
  const categoryTrends: string[] = [];
  for (const cat of analytics.topCategories.slice(0, 3)) {
    const monthlyData = analytics.byCategoryByMonth[cat.category];
    if (monthlyData) {
      const months = Object.entries(monthlyData)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 3)
        .map(([m, amt]) => `${m}: ${symbol}${amt.toFixed(0)}`)
        .join(', ');
      categoryTrends.push(`${cat.category}: ${months}`);
    }
  }

  return `${getInsightSystemPrompt(symbol)}

=== FINANCIAL SUMMARY ===
Period: ${analytics.dateRange.start} to ${analytics.dateRange.end}
Total Transactions: ${analytics.totalTransactions}

=== KEY METRICS ===
Current Month: Income ${symbol}${analytics.currentMonth.income.toFixed(0)} | Expenses ${symbol}${analytics.currentMonth.expenses.toFixed(0)}
Previous Month: Income ${symbol}${analytics.previousMonth.income.toFixed(0)} | Expenses ${symbol}${analytics.previousMonth.expenses.toFixed(0)}
3-Month Average: Income ${symbol}${analytics.threeMonthAvg.income.toFixed(0)} | Expenses ${symbol}${analytics.threeMonthAvg.expenses.toFixed(0)}

Net Balance: ${symbol}${(analytics.currentMonth.income - analytics.currentMonth.expenses).toFixed(0)}
Savings Rate: ${analytics.currentMonth.income > 0 ? (((analytics.currentMonth.income - analytics.currentMonth.expenses) / analytics.currentMonth.income) * 100).toFixed(1) : '0'}%

=== SPENDING BREAKDOWN ===
${topCategoriesSummary}

Top Merchants:
${topMerchantsSummary}

=== MONTHLY TRENDS ===
${recentMonths}

=== SPENDING PATTERNS ===
By Day of Week:
${dayOfWeekSummary}

${anomaliesSummary !== 'None detected' ? `Notable Transactions:\n${anomaliesSummary}` : ''}

Generate 4-6 meaningful insights. Return ONLY the JSON object.`;
}

/**
 * Parse the LLM response into structured insights.
 */
export function parseInsightsResponse(response: string): { insights: Array<{
  type: string;
  title: string;
  description: string;
  severity: string;
  category?: string;
  data?: Record<string, unknown>;
}> } {
  // Try direct parse
  try {
    const parsed = JSON.parse(response);
    if (parsed.insights && Array.isArray(parsed.insights)) {
      return { insights: parsed.insights.map(normalizeInsight) };
    }
  } catch {
    // Continue to try extraction
  }

  // Try extracting JSON from markdown code blocks
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (parsed.insights && Array.isArray(parsed.insights)) {
        return { insights: parsed.insights.map(normalizeInsight) };
      }
    } catch {
      // Continue
    }
  }

  // Try extracting the largest JSON object
  const objectMatch = response.match(/\{[\s\S]*"insights"[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (parsed.insights && Array.isArray(parsed.insights)) {
        return { insights: parsed.insights.map(normalizeInsight) };
      }
    } catch {
      // Continue
    }
  }

  // Return empty if all parsing fails
  console.error('[Insights] Failed to parse LLM response');
  return { insights: [] };
}

/**
 * Normalize a single insight object.
 */
function normalizeInsight(insight: unknown): {
  type: string;
  title: string;
  description: string;
  severity: string;
  category?: string;
  data?: Record<string, unknown>;
} {
  const obj = insight as Record<string, unknown>;

  const validTypes = ['category_trend', 'day_pattern', 'merchant_insight', 'anomaly', 'budget_alert', 'period_comparison', 'savings_opportunity'];
  const validSeverities = ['info', 'warning', 'positive'];

  const type = validTypes.includes(String(obj.type)) ? String(obj.type) : 'info';
  const severity = validSeverities.includes(String(obj.severity)) ? String(obj.severity) : 'info';

  return {
    type,
    title: String(obj.title || 'Spending Insight'),
    description: String(obj.description || ''),
    severity,
    category: obj.category ? String(obj.category) : undefined,
    data: obj.data && typeof obj.data === 'object' ? obj.data as Record<string, unknown> : undefined,
  };
}
