/**
 * Browser-side LM Studio client — calls LM Studio directly from the browser.
 *
 * LM Studio uses an OpenAI-compatible API with /v1/* endpoints.
 * When deployed (e.g. on Vercel), the Next.js API routes can't reach
 * localhost:1234 because LM Studio runs on the USER's machine, not on
 * the server. This client makes requests directly from the browser,
 * where "localhost" correctly refers to the user's machine.
 */

/* ── Error handling helpers ───────────────────────────────── */

interface LMStudioError {
  error?: {
    message?: string;
    type?: string;
  } | string;
}

/**
 * Parse LM Studio error response and return user-friendly message
 */
function parseLMStudioError(responseText: string, context: string): string {
  // Try to parse as JSON
  try {
    const parsed: LMStudioError = JSON.parse(responseText);

    // Handle structured error
    if (parsed.error) {
      const msg = typeof parsed.error === 'string'
        ? parsed.error.toLowerCase()
        : parsed.error.message?.toLowerCase() || '';

      // Model loading errors
      if (msg.includes('failed to load model') || msg.includes('model not found')) {
        return `Model failed to load in LM Studio. Please ensure the model is downloaded and LM Studio is running. Try reloading the model in LM Studio.`;
      }

      // Model unloaded
      if (msg.includes('model is unloaded') || msg.includes('unloaded')) {
        return `The model was unloaded. Please reload it in LM Studio and try again.`;
      }

      // Return the original message if no special handling
      const displayMsg = typeof parsed.error === 'string'
        ? parsed.error
        : parsed.error.message || 'Unknown error';
      return `LM Studio error: ${displayMsg}`;
    }
  } catch {
    // Not JSON, check for plain text patterns
    const lower = responseText.toLowerCase();
    if (lower.includes('unloaded')) {
      return `The model was unloaded. Please reload it in LM Studio and try again.`;
    }
    if (lower.includes('failed to load')) {
      return `Model failed to load in LM Studio. Please ensure the model is downloaded and LM Studio is running.`;
    }
  }

  // Fallback
  return `LM Studio ${context} failed. Please check if LM Studio is running and the model is loaded.`;
}

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
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        ...options,
      }),
    });
  } catch {
    // Network error (LM Studio not running)
    throw new Error(`Cannot connect to LM Studio at ${baseUrl}. Please ensure LM Studio is running.`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(parseLMStudioError(text, 'request'));
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
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        ...options,
      }),
    });
  } catch {
    // Network error (LM Studio not running)
    throw new Error(`Cannot connect to LM Studio at ${baseUrl}. Please ensure LM Studio is running.`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(parseLMStudioError(text, 'chat'));
  }

  if (!res.body) throw new Error("No response body from LM Studio");
  return res.body;
}
