/**
 * Browser-side LM Studio client — calls LM Studio directly from the browser.
 *
 * LM Studio uses an OpenAI-compatible API with /v1/* endpoints.
 * When deployed (e.g. on Vercel), the Next.js API routes can't reach
 * localhost:1234 because LM Studio runs on the USER's machine, not on
 * the server. This client makes requests directly from the browser,
 * where "localhost" correctly refers to the user's machine.
 */

/* ── Connection check ────────────────────────────────────── */

export async function checkLMStudioStatus(
  baseUrl: string,
): Promise<{ connected: boolean; models: string[]; selectedModel: string | null }> {
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });

    if (!res.ok) {
      return { connected: false, models: [], selectedModel: null };
    }

    const data = await res.json();
    const models = (data.data || []).map((m: { id: string }) => m.id);
    return {
      connected: true,
      models,
      selectedModel: models[0] || null,
    };
  } catch {
    return { connected: false, models: [], selectedModel: null };
  }
}

export async function listModels(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    // OpenAI format: { data: [{ id: "model-name" }] }
    return (data.data || []).map((m: { id: string }) => m.id);
  } catch {
    return [];
  }
}

/* ── Generate (non-streaming, used for parsing) ──────────── */

export async function generate(
  baseUrl: string,
  model: string,
  prompt: string,
  options?: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      // Note: LM Studio doesn't support response_format: { type: "json_object" }
      // The prompt must instruct the model to return JSON
      temperature: options?.temperature ?? 0.05,
      max_tokens: options?.max_tokens ?? 4096,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`LM Studio generate error: ${text}`);
  }

  const data = await res.json();
  // OpenAI format: { choices: [{ message: { content: "..." } }] }
  return data.choices?.[0]?.message?.content ?? "";
}

/* ── Chat (streaming, used for chat panel) ───────────────── */

export async function chatStream(
  baseUrl: string,
  model: string,
  messages: { role: string; content: string }[],
  options?: Record<string, unknown>,
): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.max_tokens ?? 4096,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`LM Studio chat error: ${text}`);
  }

  if (!res.body) throw new Error("No response body from LM Studio");
  return res.body;
}
