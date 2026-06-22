import * as fs from 'fs';
import * as path from 'path';

// Load .env.test.live if present (manual parse — no dotenv dependency). Mirrors the pattern
// in tokenBudget.spec.ts so any live test using these helpers runs with `npm run test:live`
// without requiring the caller to export env vars in their shell. Already-set env vars win.
try {
  const envPath = path.resolve(process.cwd(), '.env.test.live');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
} catch {
  // No .env.test.live or unreadable — fall through to process.env only.
}

const LIVE_LLM_URL = process.env.LIVE_LLM_URL;
const LIVE_LLM_MODEL = process.env.LIVE_LLM_MODEL || 'llama3';

export function getLiveLLMUrl(): string {
  if (!LIVE_LLM_URL) {
    throw new Error('LIVE_LLM_URL env var not set. Skipping live LLM tests.');
  }
  return LIVE_LLM_URL;
}

export function isLiveLLMAvailable(): boolean {
  return !!LIVE_LLM_URL;
}

export function getLiveLLMModel(): string {
  return LIVE_LLM_MODEL;
}

export async function callLLM(prompt: string, url: string, model: string): Promise<string> {
  // Try OpenAI-compatible format first (works for both LM Studio and Ollama with /v1 endpoint)
  const response = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

export function loadGoldenFixture(name: string): string {
  return fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'golden', name),
    'utf-8'
  );
}

export async function callLLMStream(
  messages: Array<{ role: string; content: string }>,
  url: string,
  model: string,
): Promise<string> {
  const response = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM stream request failed: ${response.status} ${response.statusText}`);
  }

  const body = response.body;
  if (!body) {
    throw new Error('No response body for streaming request');
  }

  const chunks: string[] = [];
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      if (!trimmed.startsWith('data: ')) continue;

      try {
        const parsed = JSON.parse(trimmed.slice(6)) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) chunks.push(content);
      } catch {
        // Skip unparseable lines (partial chunks, keepalive, etc.)
      }
    }
  }

  return chunks.join('');
}

export function parseJsonFromResponse(response: string): unknown {
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
  return JSON.parse(jsonStr);
}
