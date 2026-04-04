/**
 * LLM prompts for generating spending insights.
 * 
 * These prompts are used by the insights generation API to produce
 * meaningful, actionable financial insights from transaction data.
 */

import { TransactionAnalytics } from './types';
import { Currency } from '@/types';
import { debugError } from '@/lib/utils/debug';

/**
 * Get the system prompt for insight generation.
 * Includes rules, examples, and output format specification.
 */
export function getInsightSystemPrompt(currencySymbol: string): string {
  return `You are a financial advisor analyzing spending data. Generate 4-5 MEANINGFUL insights that help the user understand their financial health and take action.

DO NOT just restate the data. Instead, provide INTERPRETATION and ADVICE.

IMPORTANT CONTEXT:
- "Transfer" transactions are usually MOVING MONEY between accounts, not spending it
- Do NOT count transfers as "spending" - they're just repositioning funds
- Focus on actual EXPENSES (bills, shopping, etc.) not account transfers

Example of BAD insights (DO NOT DO THIS):
- "Monday saw ${currencySymbol}63,336 in spending" - this is just restating data
- "HDFC transaction of ${currencySymbol}58,000 is large" - obvious observation
- Treating transfers as spending
- Using statistical jargon like "z-score"
- Percentages over 100% (mathematically impossible for "portion of total")
- Repeating the same insight with different words

Example of GOOD insights:
- "Your spending is heavily concentrated in transfers (93% of expenses). Consider if all transfers are necessary or if some could be delayed."
- "You received ${currencySymbol}95,397 income but spent ${currencySymbol}143,760 - a deficit of ${currencySymbol}48,363. This pattern is unsustainable long-term."
- "Large IMPS transfers suggest you may be moving money between accounts. Track these to ensure they're not forgotten expenses."
- "Your spending is heavily concentrated in bills (93% of expenses). Consider if all transfers are necessary or if some could be delayed."

RULES:
1. Focus on PATTERNS and TRENDS, not individual transactions
2. Provide ACTIONABLE advice - what should the user DO?
3. Calculate meaningful ratios: savings rate, expense-to-income ratio, category concentration
4. Use ${currencySymbol} currency symbol (not $)
5. Keep titles short (3-5 words), descriptions 1-2 sentences
6. Vary your insights - don't make all 4 about the same category
7. Be conversational and practical

GOOD insights focus on:
1. Net cash flow (income minus actual expenses)
2. Spending concentration in non-transfer categories
3. Unusual single transactions that may need review
4. Day-of-week spending patterns (if there's a clear pattern)
5. Savings opportunities in discretionary categories

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
 * Formats transaction analytics into a structured prompt for the LLM.
 */
export function buildInsightsPrompt(analytics: TransactionAnalytics, currency: Currency): string {
  const symbol = currency.symbol;
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Format day-of-week data
  const dayOfWeekSummary = Object.entries(analytics.byDayOfWeek || {})
    .map(([day, data]) => `${dayNames[Number(day)]}: ${symbol}${data.total.toFixed(0)} (${data.count} transactions)`)
    .join('\n');

  // Defensive filter: spending composition should never include income or transfers
  const topCategoriesSummary = (analytics.topCategories || [])
    .filter((c) => c.category !== 'transfer' && c.category !== 'income')
    .map((c) => `${c.category}: ${symbol}${c.total.toFixed(0)} (${c.percentage}%)`)
    .join('\n');

  // Format top merchants
  const topMerchantsSummary = (analytics.topMerchants || [])
    .map((m) => `${m.name}: ${symbol}${m.total.toFixed(0)} (${m.count} transactions)`)
    .join('\n');

  // Format anomalies (without z-score jargon)
  const anomaliesSummary = (analytics.anomalies || []).length > 0
    ? analytics.anomalies.map((a) => `${a.description}: ${symbol}${a.amount.toFixed(0)}`).join('\n')
    : 'None detected';

  // Get the most recent month's data (not current calendar month)
  const sortedMonths = Object.keys(analytics.byMonth || {}).sort();
  const latestMonth = sortedMonths[sortedMonths.length - 1];
  const latestMonthData = latestMonth ? analytics.byMonth[latestMonth] : { income: 0, expenses: 0 };

  const income = latestMonthData.income || 0;
  const expenses = latestMonthData.expenses || 0;
  const netBalance = income - expenses;
  const savingsRate = income > 0 ? ((netBalance / income) * 100).toFixed(1) : '0';

  // Format monthly data (last 6 months)
  const recentMonths = Object.entries(analytics.byMonth || {})
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6)
    .map(([month, data]) => `${month}: Income ${symbol}${data.income.toFixed(0)}, Expenses ${symbol}${data.expenses.toFixed(0)}`)
    .join('\n');

  // Transfer info (to explicitly call out)
  const transferInfo = analytics.byCategory?.transfer;

  return `${getInsightSystemPrompt(symbol)}

=== FINANCIAL SUMMARY ===
Period: ${analytics.dateRange?.start || 'N/A'} to ${analytics.dateRange?.end || 'N/A'}
Month Analyzed: ${latestMonth || 'N/A'}
Total Transactions: ${analytics.totalTransactions || 0}

=== KEY METRICS ===
Income: ${symbol}${income.toFixed(0)}
Expenses: ${symbol}${expenses.toFixed(0)}
Net Balance: ${symbol}${netBalance.toFixed(0)}
Savings Rate: ${savingsRate}%

${transferInfo ? `NOTE: ${symbol}${transferInfo.total.toFixed(0)} in transfers (moving money between accounts, not spending)` : ''}

=== SPENDING CATEGORIES (excluding income and transfers) ===
${topCategoriesSummary || 'No expense categories'}

Top Merchants:
${topMerchantsSummary || 'No data'}

=== MONTHLY TRENDS ===
${recentMonths || 'No data'}

=== SPENDING PATTERNS ===
By Day of Week:
${dayOfWeekSummary || 'No data'}

${anomaliesSummary !== 'None detected' ? `LARGE TRANSACTIONS:\n${anomaliesSummary}` : ''}

Generate 4-5 meaningful insights. Return ONLY the JSON object.`;
}

/**
 * Parse the LLM response into structured insights.
 * Handles multiple response formats (direct JSON, markdown code blocks, embedded JSON).
 */
export function parseInsightsResponse(response: string): { 
  insights: Array<{
    type: string;
    title: string;
    description: string;
    severity: string;
    category?: string;
    data?: Record<string, unknown>;
  }> 
} {
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
  debugError('Insights', 'Failed to parse LLM response');
  return { insights: [] };
}

/**
 * Normalize a single insight object.
 * Validates and provides defaults for insight fields.
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

  const validTypes = [
    'category_trend', 
    'day_pattern', 
    'merchant_insight', 
    'anomaly', 
    'budget_alert', 
    'period_comparison', 
    'savings_opportunity'
  ];
  const validSeverities = ['info', 'warning', 'positive'];

  const type = validTypes.includes(String(obj.type)) ? String(obj.type) : 'category_trend';
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
