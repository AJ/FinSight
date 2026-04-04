/**
 * @deprecated Server-side categorization is no longer used.
 * 
 * All callers now use direct browser LLM calls via runCategorizationCore().
 * This route is kept for potential future use but can be safely deleted.
 * 
 * Only used when categorizeTransactions() is called WITHOUT a model:
 * - Browser falls back to this API if options.model is empty/undefined
 * - Currently all callers (FileProcessor, transactionStore, transactions/page) pass a model
 * 
 * To delete safely:
 * 1. Remove this file
 * 2. Remove categorizeTransactionsViaApi() from aiCategorizer.ts
 * 3. Remove the fallback branch: `: await categorizeTransactionsViaApi(...)`
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/llm/index";
import { LLMProvider } from "@/lib/llm/types";
import { validateLlmServerUrl } from "@/lib/store/settingsStore";
import { checkRateLimit, getClientIdentifier, STRICT_RATE_LIMIT } from "@/lib/middleware/rateLimit";
import { debugLog, debugSensitive, debugError, debugWarn } from "@/lib/utils/debug";
import { runCategorizationCore } from "@/lib/categorization/core";
import { normalizeTransactionTypeStrict } from '@/models/TransactionType';
import { CategorizeRequestSchema, CategorizeResponseSchema } from '@/lib/validation/llmApiSchemas';
import { fromZodError } from 'zod-validation-error';
import type { SourceType } from '@/types';
import type { TransactionSubType } from '@/models/Transaction';
import type { CategorizationResult, CategorizationTransactionInput } from "@/lib/categorization/types";

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // Rate limiting
  const clientId = getClientIdentifier(request);
  const rateLimit = checkRateLimit(clientId, STRICT_RATE_LIMIT);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": String(rateLimit.limit),
          "X-RateLimit-Remaining": String(rateLimit.remaining),
          "X-RateLimit-Reset": String(rateLimit.resetTime),
        }
      }
    );
  }

  try {
    const body = await request.json();
    
    // Validate request body against schema
    const parseResult = CategorizeRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid request format', details: fromZodError(parseResult.error).message },
        { status: 400 }
      );
    }

    const { transactions, provider, baseUrl, model } = parseResult.data;

    debugLog(`[Categorize] Request received:`, {
      transactionCount: transactions?.length || 0,
      provider,
      model,
    });

    const llmProvider = (provider as LLMProvider) || "ollama";
    
    // Normalize transactions with validation
    const normalizedTransactions: CategorizationTransactionInput[] = [];
    const rejectedTransactions: Array<{ txn: unknown; reason: string }> = [];

    for (const txn of transactions) {
      try {
        normalizedTransactions.push({
          id: String(txn.id),
          description: String(txn.description || ""),
          merchant: txn.merchant ? String(txn.merchant) : undefined,
          amount: typeof txn.amount === "number" ? txn.amount : Number(txn.amount) || 0,
          type: normalizeTransactionTypeStrict(txn.type),
          sourceType: txn.sourceType as SourceType | undefined,
          transactionSubType: txn.transactionSubType as TransactionSubType | undefined,
          categoryId: txn.categoryId,
        });
      } catch (error) {
        rejectedTransactions.push({
          txn,
          reason: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Log rejected transactions
    if (rejectedTransactions.length > 0) {
      debugWarn(
        'Categorize',
        `Rejected ${rejectedTransactions.length}/${transactions.length} transactions with invalid types:`,
        rejectedTransactions
      );
    }

    const urlParam = (baseUrl as string) || "http://localhost:11434";

    // Validate URL to prevent SSRF
    const validation = validateLlmServerUrl(urlParam);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || "Invalid URL" },
        { status: 400 }
      );
    }
    const llmUrl = validation.sanitized;

    const client = getServerClient(llmProvider);

    // Resolve model
    let selectedModel = model as string | undefined;
    if (!selectedModel) {
      const models = await client.listModels(llmUrl);
      selectedModel = models[0];
      debugLog(`[Categorize] Auto-selected model: ${selectedModel}`);
    }
    if (!selectedModel) {
      debugError(`[Categorize] No model available`);
      return NextResponse.json(
        { error: "No AI model available" },
        { status: 500 }
      );
    }

    debugLog(`[Categorize] Processing ${normalizedTransactions.length} transactions`);

    const results: CategorizationResult[] = await runCategorizationCore(
      normalizedTransactions,
      {
        generate: async (prompt) => {
          debugSensitive("Categorize Prompt", prompt);
          const response = await client.generate(llmUrl, selectedModel!, prompt);
          debugSensitive("Categorize Response", response);
          return response;
        },
      }
    );

    const totalDuration = Date.now() - startTime;
    debugLog(`[Categorize] Completed: ${results.length} results in ${totalDuration}ms`);

    // Validate response
    const responseParseResult = CategorizeResponseSchema.safeParse({ results });
    if (!responseParseResult.success) {
      debugError('[Categorize] Response validation failed:', fromZodError(responseParseResult.error).message);
      // Return results anyway but log the validation error
    }

    return NextResponse.json(
      { results },
      {
        headers: {
          "X-RateLimit-Limit": String(rateLimit.limit),
          "X-RateLimit-Remaining": String(rateLimit.remaining),
        }
      }
    );
  } catch (error) {
    debugError("[Categorize] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Categorization failed" },
      { status: 500 }
    );
  }
}
