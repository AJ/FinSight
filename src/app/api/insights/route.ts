import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/lib/llm/index';
import { LLMProvider } from '@/lib/llm/types';
import { validateLlmServerUrl } from '@/lib/store/settingsStore';
import { checkRateLimit, getClientIdentifier, STRICT_RATE_LIMIT } from '@/lib/middleware/rateLimit';
import { debugLog, debugSensitive, debugError } from '@/lib/utils/debug';
import { TransactionAnalytics } from '@/lib/insights/types';
import { buildInsightsPrompt, parseInsightsResponse } from '@/lib/insights/prompts';
import { InsightsRequestSchema, InsightsResponseSchema } from '@/lib/validation/llmApiSchemas';
import { fromZodError } from 'zod-validation-error';

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
    
    // Validate request body against schema
    const parseResult = InsightsRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid request format', details: fromZodError(parseResult.error).message },
        { status: 400 }
      );
    }

    const { analytics, provider, baseUrl, model, currency } = parseResult.data;

    debugLog('[Insights] Request received:', {
      provider,
      model,
      transactionCount: analytics?.totalTransactions,
      currency: currency.code,
    });

    // Validate URL to prevent SSRF
    const defaultUrl = 'http://localhost:11434';
    const urlParam = baseUrl || defaultUrl;
    const validation = validateLlmServerUrl(urlParam);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || 'Invalid URL' },
        { status: 400 }
      );
    }
    const safeUrl = validation.sanitized;

    // Build the prompt with user's currency
    const prompt = buildInsightsPrompt(analytics as TransactionAnalytics, currency);
    debugSensitive('Insights Prompt', prompt);

    // Get the server-side client
    const llmProvider = (provider as LLMProvider) || 'ollama';
    const client = getServerClient(llmProvider);

    // Resolve model (use requested model, else first available)
    let selectedModel =
      typeof model === 'string' && model.trim().length > 0
        ? model.trim()
        : undefined;

    if (!selectedModel) {
      const models = await client.listModels(safeUrl);
      
      // Filter out coding/specialized models, prefer general-purpose
      const suitableModels = models.filter(m => {
        const name = m.toLowerCase();
        return !name.includes('code') && !name.includes('coder');
      });
      
      selectedModel = suitableModels[0] || models[0];
      
      if (selectedModel) {
        console.warn(
          `[Insights] No model specified. Auto-selected: "${selectedModel}". ` +
          `This should not happen - client should always send a model.`
        );
      }
    }

    if (!selectedModel) {
      return NextResponse.json(
        { error: 'No AI model available. Load/pull a model first.' },
        { status: 500 }
      );
    }

    debugLog('[Insights] Calling LLM...');

    // Generate insights
    const response = await client.generate(safeUrl, selectedModel, prompt, {
      temperature: 0.05,
    });

    debugLog(`[Insights] Response received (${response.length} chars)`);
    debugSensitive('Insights Response', response);

    // Parse the response
    const parsed = parseInsightsResponse(response);
    const insights = parsed.insights;
    debugLog(`[Insights] Parsed ${insights.length} insights`);

    // Validate response
    const responseParseResult = InsightsResponseSchema.safeParse({ insights });
    if (!responseParseResult.success) {
      debugError('[Insights] Response validation failed:', fromZodError(responseParseResult.error).message);
      // Return results anyway but log the validation error
    }

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

