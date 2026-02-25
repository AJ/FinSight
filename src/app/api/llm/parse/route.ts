import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/llm/index";
import { LLMProvider } from "@/lib/llm/types";
import { validateOllamaUrl } from "@/lib/store/settingsStore";
import { checkRateLimit, getClientIdentifier, STRICT_RATE_LIMIT } from "@/lib/middleware/rateLimit";
import { debugLog, debugWarn, debugError } from "@/lib/utils/debug";

/* ============================================================
   LLM PARSE ENDPOINT
   Receives raw text from any bank statement (PDF/CSV/XLS)
   and returns structured JSON transactions.
   ============================================================ */

const PARSE_PROMPT = `You are an expert bank statement parser. Your job is to extract ALL financial transactions from the raw text of a bank statement.

IMPORTANT RULES:
1. Extract EVERY single transaction — do NOT skip any.
2. Auto-detect the currency from the statement (look for symbols like ₹, $, €, £, ¥ or words like Rupee, Dollar, Euro, or ISO codes like INR, USD, EUR).
3. Auto-detect the date format used (DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-Mon-YYYY, etc.).
4. For each transaction, extract:
   - date: in YYYY-MM-DD format
   - description: the payee, merchant, or narration text
   - amount: the absolute numeric value (always positive)
   - type: "expense" for debits/withdrawals/payments/money-out, "income" for credits/deposits/transfers-in/money-in
5. Look for these clues to determine type:
   - Separate "Debit" and "Credit" columns → debit = expense, credit = income
   - Keywords: DEBIT/DR/WITHDRAWAL/PAID/SENT = expense; CREDIT/CR/DEPOSIT/RECEIVED/REFUND = income
   - Negative amounts or amounts in parentheses = expense
   - Column headers like "Money Out" vs "Money In"
6. Do NOT include opening/closing balance rows, interest calculations, or summary rows — only actual transactions.
7. Do NOT hallucinate transactions. Only extract what is actually in the text.
8. Output ONLY valid JSON — no markdown fences, no explanation, no extra text.

REQUIRED JSON FORMAT:
{"currency":{"code":"INR","symbol":"₹","name":"Indian Rupee"},"transactions":[{"date":"2024-01-15","description":"Amazon Purchase","amount":500.00,"type":"expense"},{"date":"2024-01-20","description":"Salary Credit","amount":50000.00,"type":"income"}]}

BANK STATEMENT TEXT:
---
`;

export async function POST(request: Request) {
  // Rate limiting
  const clientId = getClientIdentifier(request);
  const rateLimit = checkRateLimit(clientId, STRICT_RATE_LIMIT);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  try {
    const { text, model, ollamaUrl, provider } = await request.json();
    const urlParam = (ollamaUrl as string) || "http://localhost:11434";
    const llmProvider = (provider as LLMProvider) || "ollama";

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    // Validate URL to prevent SSRF
    const validation = validateOllamaUrl(urlParam);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || "Invalid URL" },
        { status: 400 }
      );
    }
    const baseUrl = validation.sanitized;

    const client = getServerClient(llmProvider);

    // Resolve model
    let selectedModel = model as string | undefined;
    if (!selectedModel) {
      const models = await client.listModels(baseUrl);
      selectedModel = models[0];
    }
    if (!selectedModel) {
      return NextResponse.json(
        {
          error:
            "No AI model available. Pull a model first (e.g. ollama pull llama3.2)",
        },
        { status: 500 },
      );
    }

    // Chunk long statements — use larger chunks to avoid splitting transactions
    const MAX_CHUNK_CHARS = 12000;
    const chunks = splitTextIntoChunks(text, MAX_CHUNK_CHARS);
    debugLog(
      `[LLM Parse] ${chunks.length} chunk(s), model: ${selectedModel}, provider: ${llmProvider}`,
    );

    const allTransactions: Record<string, unknown>[] = [];
    let currency: Record<string, string> | null = null;

    for (let i = 0; i < chunks.length; i++) {
      debugLog(
        `[LLM Parse] Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`,
      );
      const prompt =
        PARSE_PROMPT + chunks[i] + "\n---\n\nExtract all transactions as JSON:";

      let raw: string;
      try {
        raw = await client.generate(baseUrl, selectedModel, prompt, {
          temperature: 0.05, // Near-deterministic for parsing
        });
      } catch (err) {
        debugError(`[LLM Parse] Chunk ${i + 1} failed:`, err);
        continue; // Skip failed chunk, try the rest
      }

      const parsed = safeParseJSON(raw);
      if (parsed) {
        if (Array.isArray(parsed.transactions)) {
          allTransactions.push(...parsed.transactions);
        }
        if (parsed.currency && !currency) {
          currency = parsed.currency as Record<string, string>;
        }
      } else {
        debugWarn(
          `[LLM Parse] Chunk ${i + 1}: could not extract JSON from response`,
        );
      }
    }

    // Validate & deduplicate transactions
    const seen = new Set<string>();
    const validTransactions = allTransactions.filter(
      (t: Record<string, unknown>) => {
        if (!t.date || !t.description || typeof t.amount !== "number")
          return false;
        if (t.type !== "income" && t.type !== "expense") return false;
        if (t.amount === 0) return false;

        // Dedup key
        const key = `${t.date}|${String(t.description).substring(0, 30)}|${Math.abs(t.amount as number)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      },
    );

    // Normalize amounts: ensure expenses are negative, income positive
    const normalizedTransactions = validTransactions.map((t) => ({
      ...t,
      amount:
        t.type === "expense"
          ? -Math.abs(t.amount as number)
          : Math.abs(t.amount as number),
    }));

    debugLog(
      `[LLM Parse] ${normalizedTransactions.length} valid transactions extracted`,
    );

    return NextResponse.json({
      currency: currency || { code: "USD", symbol: "$", name: "US Dollar" },
      transactions: normalizedTransactions,
      model: selectedModel,
    });
  } catch (error) {
    debugError("[LLM Parse]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "LLM parsing failed" },
      { status: 500 },
    );
  }
}

/* ── helpers ─────────────────────────────────────────────── */

function splitTextIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";

  // Keep the first few lines (header) as context for each chunk
  const headerLines = lines.slice(0, 5).join("\n");

  for (const line of lines) {
    if ((current + "\n" + line).length > maxChars && current.length > 0) {
      chunks.push(current);
      // Start new chunk with header context
      current = headerLines + "\n...\n" + line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function safeParseJSON(raw: string): Record<string, unknown> | null {
  // Try direct parse
  try {
    return JSON.parse(raw);
  } catch {
    /* continue */
  }

  // Try extracting JSON from markdown code blocks
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      /* continue */
    }
  }

  // Try extracting the largest JSON object
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      /* continue */
    }

    // Try fixing common JSON issues (trailing commas, etc.)
    let fixed = match[0];
    fixed = fixed.replace(/,\s*([}\]])/g, "$1"); // Remove trailing commas
    try {
      return JSON.parse(fixed);
    } catch {
      /* continue */
    }
  }

  return null;
}
