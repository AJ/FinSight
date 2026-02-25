/**
 * Browser-side Ollama client — calls Ollama directly from the browser.
 *
 * When deployed (e.g. on Vercel), the Next.js API routes can't reach
 * localhost:11434 because Ollama runs on the USER's machine, not on
 * the server. This client makes requests directly from the browser,
 * where "localhost" correctly refers to the user's machine.
 */

/* ── Connection check ────────────────────────────────────── */

export async function checkOllamaStatus(
  baseUrl: string,
): Promise<{ connected: boolean; models: string[]; selectedModel: string | null }> {
  try {
    const res = await fetch(baseUrl, {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) return { connected: false, models: [], selectedModel: null };

    const models = await listModels(baseUrl);
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
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m: { name: string }) => m.name);
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
  const res = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: "json",
      options: {
        num_ctx: 16384,
        temperature: 0.05,
        ...options,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Ollama generate error: ${text}`);
  }

  const data = await res.json();
  return data.response;
}

/* ── Chat (streaming, used for chat panel) ───────────────── */

export async function chatStream(
  baseUrl: string,
  model: string,
  messages: { role: string; content: string }[],
  options?: Record<string, unknown>,
): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      options: {
        num_ctx: 8192,
        temperature: 0.7,
        ...options,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Ollama chat error: ${text}`);
  }

  if (!res.body) throw new Error("No response body from Ollama");
  return res.body;
}
