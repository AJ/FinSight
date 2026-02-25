import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/llm/index";
import { LLMProvider } from "@/lib/llm/types";
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

  try {
    const { transactions, provider, baseUrl, model } = await request.json();

    console.log(`[Categorize] Request received:`, {
      transactionCount: transactions?.length || 0,
      provider,
      model,
      baseUrl,
    });

    if (!Array.isArray(transactions) || transactions.length === 0) {
      return NextResponse.json(
        { error: "No transactions provided" },
        { status: 400 }
      );
    }

    const llmProvider = (provider as LLMProvider) || "ollama";
    const llmUrl = (baseUrl as string) || "http://localhost:11434";

    const client = getServerClient(llmProvider);

    // Resolve model
    let selectedModel = model as string | undefined;
    if (!selectedModel) {
      const models = await client.listModels(llmUrl);
      selectedModel = models[0];
      console.log(`[Categorize] Auto-selected model: ${selectedModel}`);
    }
    if (!selectedModel) {
      console.error(`[Categorize] No model available at ${llmUrl}`);
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

    console.log(`[Categorize] Processing ${transactions.length} transactions in ${batches.length} batch(es)`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchStart = Date.now();
      console.log(`[Categorize] Batch ${i + 1}/${batches.length}: ${batch.length} transactions`);

      const prompt = buildCategorizationPrompt(batch);
      console.log(`[Categorize] Batch ${i + 1} Prompt (${prompt.length} chars):`);
      console.log("---PROMPT START---");
      console.log(prompt);
      console.log("---PROMPT END---");

      try {
        // Use model's default temperature
        const response = await client.generate(llmUrl, selectedModel, prompt);
        const batchDuration = Date.now() - batchStart;

        console.log(`[Categorize] Batch ${i + 1} Response (${batchDuration}ms, ${response.length} chars):`);
        console.log("---RESPONSE START---");
        console.log(response);
        console.log("---RESPONSE END---");

        const batchResults = parseCategorizationResponse(response);
        console.log(`[Categorize] Batch ${i + 1} parsed ${batchResults.length} results`);

        // Log any parsing issues
        if (batchResults.length !== batch.length) {
          console.warn(`[Categorize] Batch ${i + 1} mismatch: expected ${batch.length}, got ${batchResults.length}`);
        }

        // Match results to transactions
        for (const txn of batch) {
          const result = batchResults.find((r) => r.id === txn.id);
          if (result) {
            results.push(result);
          } else {
            // Fallback
            const fallbackCat = categorizeByKeywords(txn as TransactionInput);
            console.log(`[Categorize] Fallback for ${txn.id}: ${fallbackCat}`);
            results.push({
              id: txn.id,
              category: fallbackCat,
              confidence: 0.3,
            });
          }
        }
      } catch (err) {
        console.error(`[Categorize] Batch ${i + 1} failed:`, err);
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
    console.log(`[Categorize] Completed: ${results.length} results in ${totalDuration}ms`);

    // Log summary by category
    const categoryCounts: Record<string, number> = {};
    for (const r of results) {
      categoryCounts[r.category] = (categoryCounts[r.category] || 0) + 1;
    }
    console.log(`[Categorize] Category breakdown:`, categoryCounts);

    return NextResponse.json({ results });
  } catch (error) {
    console.error("[Categorize] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Categorization failed" },
      { status: 500 }
    );
  }
}
