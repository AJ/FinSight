import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/lib/llm/index';
import { validateOllamaUrl } from '@/lib/store/settingsStore';
import { checkRateLimit, getClientIdentifier, STRICT_RATE_LIMIT } from '@/lib/middleware/rateLimit';
import { debugLog, debugSensitive, debugError } from '@/lib/utils/debug';
import { TransactionAnalytics } from '@/lib/insights/types';
import { Currency } from '@/types';

interface InsightResponse {
  type: string;
  title: string;
  description: string;
  severity: string;
  category?: string;
  data?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  // Rate limiting
  const clientId = getClientIdentifier(request);
  const rateLimit = checkRateLimit(clientId, STRICT_RATE_LIMIT);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(rateLimit.limit),
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': String(rateLimit.resetTime),
        },
      }
    );
  }

  try {
    const body = await request.json();
    const { analytics, provider, baseUrl, model, currency } = body;

    debugLog('[Insights] Request received:', {
      provider,
      model,
      transactionCount: analytics?.totalTransactions,
    });

    if (!model) {
      return NextResponse.json(
        { error: 'No model specified' },
        { status: 400 }
      );
    }

    // Validate URL to prevent SSRF
    const defaultUrl = 'http://localhost:11434';
    const urlParam = baseUrl || defaultUrl;
    const validation = validateOllamaUrl(urlParam);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || 'Invalid URL' },
        { status: 400 }
      );
    }
    const safeUrl = validation.sanitized;

    // Build the prompt
    const prompt = buildPrompt(analytics, currency);
    debugSensitive('Insights Prompt', prompt);

    // Get the server-side client
    const client = getServerClient(provider);

    debugLog('[Insights] Calling LLM...');

    // Generate insights
    const response = await client.generate(safeUrl, model, prompt, {
      temperature: 0.3,
    });

    debugLog(`[Insights] Response received (${response.length} chars)`);
    debugSensitive('Insights Response', response);

    // Parse the response
    const insights = parseInsightsJSON(response);
    debugLog(`[Insights] Parsed ${insights.length} insights`);

    return NextResponse.json(
      { insights },
      {
        headers: {
          'X-RateLimit-Limit': String(rateLimit.limit),
          'X-RateLimit-Remaining': String(rateLimit.remaining),
        },
      }
    );
  } catch (error) {
    debugError('[Insights] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate insights' },
      { status: 500 }
    );
  }
}

function buildPrompt(analytics: TransactionAnalytics, currency: Currency): string {
  const symbol = currency?.symbol || '$';

  const systemPrompt = `You are a financial advisor analyzing transaction data. Generate 4-5 practical insights to help the user understand their finances.

IMPORTANT CONTEXT:
- "Transfer" transactions are usually MOVING MONEY between accounts, not spending it
- Do NOT count transfers as "spending" - they're just repositioning funds
- Focus on actual EXPENSES (bills, shopping, etc.) not account transfers

GOOD insights focus on:
1. Net cash flow (income minus actual expenses)
2. Spending concentration in non-transfer categories
3. Unusual single transactions that may need review
4. Day-of-week spending patterns (if there's a clear pattern)
5. Savings opportunities in discretionary categories

BAD insights (avoid these):
- Treating transfers as spending
- Using statistical jargon like "z-score"
- Restating obvious numbers without interpretation
- Repeating the same insight with different words
- Percentages over 100% (mathematically impossible for "portion of total")

RULES:
1. Be conversational and practical
2. Use ${symbol} for currency (not $)
3. Keep titles 3-5 words, descriptions 1-2 sentences
4. Provide specific, actionable advice
5. Vary your insights - don't make all 4 about the same category

CATEGORY FIELD (only if relevant to the insight):
Valid values: groceries, dining, transportation, utilities, housing, healthcare, entertainment, shopping, income, interest, transfer, bills, investment, insurance, education, travel, other

SEVERITY:
- "positive": Good financial news
- "warning": Areas needing attention
- "info": Useful observation

Output ONLY valid JSON:
{"insights":[{"type":"category_trend","title":"...","description":"...","severity":"warning","category":"bills"}]}

No markdown. Only JSON.`;

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const dayOfWeekSummary = Object.entries(analytics.byDayOfWeek || {})
    .map(([day, data]) => `${dayNames[Number(day)]}: ${symbol}${data.total.toFixed(0)} (${data.count} txns)`)
    .join('\n');

  // Filter out transfers from category breakdown
  const topCategoriesSummary = (analytics.topCategories || [])
    .filter((c) => c.category !== 'transfer')
    .map((c) => `${c.category}: ${symbol}${c.total.toFixed(0)} (${c.percentage}%)`)
    .join('\n');

  const transferInfo = (analytics.topCategories || []).find((c) => c.category === 'transfer');

  const anomaliesSummary = (analytics.anomalies || []).length > 0
    ? analytics.anomalies.map((a) => `${a.description}: ${symbol}${a.amount.toFixed(0)}`).join('\n')
    : '';

  // Get the most recent month's data (not current calendar month)
  const sortedMonths = Object.keys(analytics.byMonth || {}).sort();
  const latestMonth = sortedMonths[sortedMonths.length - 1];
  const latestMonthData = latestMonth ? analytics.byMonth[latestMonth] : { income: 0, expenses: 0 };

  const income = latestMonthData.income || 0;
  const expenses = latestMonthData.expenses || 0;
  const netBalance = income - expenses;
  const savingsRate = income > 0 ? ((netBalance / income) * 100).toFixed(1) : '0';

  debugLog('[Insights] Latest month:', latestMonth, 'Income:', income, 'Expenses:', expenses);

  return `${systemPrompt}

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

=== SPENDING CATEGORIES (excluding transfers) ===
${topCategoriesSummary || 'No expense categories'}

=== SPENDING BY DAY ===
${dayOfWeekSummary || 'No data'}

${anomaliesSummary ? `LARGE TRANSACTIONS:\n${anomaliesSummary}` : ''}

Generate 4-5 practical insights. Return ONLY JSON.`;
}

function parseInsightsJSON(response: string): InsightResponse[] {
  // Try direct parse
  try {
    const parsed = JSON.parse(response);
    if (parsed.insights && Array.isArray(parsed.insights)) {
      return parsed.insights.map(normalizeInsight);
    }
  } catch {
    // Continue
  }

  // Try extracting from code blocks
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (parsed.insights && Array.isArray(parsed.insights)) {
        return parsed.insights.map(normalizeInsight);
      }
    } catch {
      // Continue
    }
  }

  // Try extracting JSON object
  const objectMatch = response.match(/\{[\s\S]*"insights"[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (parsed.insights && Array.isArray(parsed.insights)) {
        return parsed.insights.map(normalizeInsight);
      }
    } catch {
      // Continue
    }
  }

  debugError('[Insights] Failed to parse response');
  return [];
}

function normalizeInsight(insight: Partial<InsightResponse>): InsightResponse {
  const validTypes = ['category_trend', 'day_pattern', 'merchant_insight', 'anomaly', 'budget_alert', 'period_comparison', 'savings_opportunity'];
  const validSeverities = ['info', 'warning', 'positive'];

  return {
    type: validTypes.includes(insight.type || '') ? insight.type! : 'category_trend',
    title: insight.title || 'Spending Insight',
    description: insight.description || '',
    severity: validSeverities.includes(insight.severity || '') ? insight.severity! : 'info',
    category: insight.category || undefined,
  };
}
