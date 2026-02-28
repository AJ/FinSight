import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/llm/index";
import { LLMProvider } from "@/lib/llm/types";
import { validateOllamaUrl } from "@/lib/store/settingsStore";
import { checkRateLimit, getClientIdentifier, STRICT_RATE_LIMIT } from "@/lib/middleware/rateLimit";
import { debugLog, debugSensitive, debugError } from "@/lib/utils/debug";
import {
  buildCategorizationPrompt,
  parseCategorizationResponse,
} from "@/lib/categorization/prompts";
import { categorizeByKeywords } from "@/lib/categorization/aiCategorizer";

const BATCH_SIZE = 20;

interface TransactionInput {
  id: string;
  description: string;
  amount: number;
  type: "income" | "expense";
}

interface CategorizationResult {
  id: string;
  category: string;
  confidence: number;
}

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
    const { transactions, provider, baseUrl, model } = await request.json();

    debugLog(`[Categorize] Request received:`, {
      transactionCount: transactions?.length || 0,
      provider,
      model,
    });

    if (!Array.isArray(transactions) || transactions.length === 0) {
      return NextResponse.json(
        { error: "No transactions provided" },
        { status: 400 }
      );
    }

    const llmProvider = (provider as LLMProvider) || "ollama";
    const urlParam = (baseUrl as string) || "http://localhost:11434";

    // Validate URL to prevent SSRF
    const validation = validateOllamaUrl(urlParam);
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

    // Process in batches
    const results: CategorizationResult[] = [];
    const batches: TransactionInput[][] = [];

    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
      batches.push(transactions.slice(i, i + BATCH_SIZE));
    }

    debugLog(`[Categorize] Processing ${transactions.length} transactions in ${batches.length} batch(es)`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchStart = Date.now();
      debugLog(`[Categorize] Batch ${i + 1}/${batches.length}: ${batch.length} transactions`);

      const prompt = buildCategorizationPrompt(batch);
      debugSensitive(`Categorize Batch ${i + 1} Prompt`, prompt);

      try {
        const response = await client.generate(llmUrl, selectedModel, prompt);
        const batchDuration = Date.now() - batchStart;

        debugLog(`[Categorize] Batch ${i + 1} completed in ${batchDuration}ms`);
        debugSensitive(`Categorize Batch ${i + 1} Response`, response);

        const batchResults = parseCategorizationResponse(response);
        debugLog(`[Categorize] Batch ${i + 1} parsed ${batchResults.length} results`);

        // Match results to transactions
        for (const txn of batch) {
          const result = batchResults.find((r) => r.id === txn.id);
          if (result) {
            results.push(result);
          } else {
            // Fallback
            const fallbackCat = categorizeByKeywords(txn);
            debugLog(`[Categorize] Fallback for ${txn.id}: ${fallbackCat}`);
            results.push({
              id: txn.id,
              category: fallbackCat,
              confidence: 0.3,
            });
          }
        }
      } catch (err) {
        debugError(`[Categorize] Batch ${i + 1} failed:`, err);
        // Fallback for entire batch
        for (const txn of batch) {
          results.push({
            id: txn.id,
            category: categorizeByKeywords(txn as TransactionInput),
            confidence: 0.3,
          });
        }
      }
    }

    const totalDuration = Date.now() - startTime;
    debugLog(`[Categorize] Completed: ${results.length} results in ${totalDuration}ms`);

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
