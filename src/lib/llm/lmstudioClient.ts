/**
 * LM Studio REST API client — server-side only (used in API routes).
 * LM Studio uses an OpenAI-compatible API (/v1/* endpoints).
 */

const DEFAULT_URL = "http://localhost:1234";

export async function checkLMStudioRunning(
  baseUrl: string = DEFAULT_URL,
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listModels(
  baseUrl: string = DEFAULT_URL,
): Promise<string[]> {
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

export async function generate(
  baseUrl: string = DEFAULT_URL,
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

export async function chatStream(
  baseUrl: string = DEFAULT_URL,
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
