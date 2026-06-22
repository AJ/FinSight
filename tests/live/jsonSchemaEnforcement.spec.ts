/**
 * Live regression test for JSON Schema enforcement (spec §9.6 / plan Task 15).
 *
 * This is the test that actually proves the wire fix. The original bug: the OpenAI adapter
 * emitted `response_format: { type: 'json_object' }`, which LM Studio rejected. The fix sends
 * a permissive `json_schema` (OpenAI) / `format: <schema>` (Ollama). To exercise the wire
 * format, this test MUST go through the REAL adapter (`createClient`), not the raw `callLLM`
 * helper — a raw-call test would pass even if the adapter still emitted `json_object`, because
 * it never touches the adapter.
 *
 * Gated on LIVE_LLM_URL (see tests/live/helpers.ts). Provider is derived from the URL:
 * port 11434 → Ollama adapter, otherwise → OpenAI adapter (LM Studio). Run once per provider:
 *
 *   LIVE_LLM_URL=http://localhost:1234 LIVE_LLM_MODEL=<model> npm run test:live      # LM Studio
 *   LIVE_LLM_URL=http://localhost:11434 LIVE_LLM_MODEL=<model> npm run test:live     # Ollama
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  isLiveLLMAvailable,
  getLiveLLMUrl,
  getLiveLLMModel,
  loadGoldenFixture,
} from './helpers';
import { createClient } from '@/lib/llm/client';
import type { LLMProvider } from '@/lib/llm/types';
import {
  TYPE_DETECTION_PROMPT,
  TYPE_DETECTION_SCHEMA,
  CC_TRANSACTIONS_SCHEMA,
} from '@/lib/parsers/prompts';
import { buildTransactionsPrompt } from '@/lib/parsers/extractTransactions';
import { EXTRACTION_SYSTEM_PROMPT } from '@/lib/llm/prompts';
import { normalizeStatementText } from '@/lib/parsers/normalization';
import { parseLLMJsonResponse } from '@/lib/utils/llm-response-parser';

const describeLive = isLiveLLMAvailable() ? describe : describe.skip;

function providerForUrl(url: string): LLMProvider {
  // 11434 = Ollama default; anything else (e.g. 1234) = OpenAI-compatible (LM Studio).
  return url.includes('11434') ? 'ollama' : 'lmstudio';
}

describeLive('JSON Schema enforcement against a live LLM', () => {
  let url: string;
  let model: string;
  let provider: LLMProvider;

  beforeAll(() => {
    url = getLiveLLMUrl();
    model = getLiveLLMModel();
    provider = providerForUrl(url);
  });

  // Regression for the original bug: LM Studio rejected json_object. If the adapter still
  // emitted json_object (or the schema envelope is malformed), generate() throws and this
  // test fails. A pass means the provider accepted our schema and returned schema-valid JSON.
  it('type detection returns schema-valid JSON through the real adapter', async () => {
    const text = loadGoldenFixture('bankStatement.txt').slice(0, 1000);
    const prompt = TYPE_DETECTION_PROMPT.replace('{RAW_TEXT}', text);
    const client = createClient(provider);

    const raw = await client.generate(url, model, prompt, {
      stage: 'type_detection_live',
      temperature: 0,
      responseFormat: 'json',
      responseSchema: TYPE_DETECTION_SCHEMA,
      schemaName: 'statement_type',
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    });

    const parsed = parseLLMJsonResponse<{ type: string; confidence: number }>(raw);
    expect(['bank', 'credit_card', 'unknown']).toContain(parsed.type);
    expect(typeof parsed.confidence).toBe('number');
  }, 120_000);

  // Verifies the wire schema actually constrains output: the transaction `type` enum
  // (debit|credit) must be honored by the decoder, and amounts must be numeric.
  it('cc transaction extraction returns schema-valid JSON with constrained types', async () => {
    const normalized = normalizeStatementText(loadGoldenFixture('ccStatement.txt'));
    const prompt = buildTransactionsPrompt(normalized.slice(0, 6000), 'credit_card', null);
    const client = createClient(provider);

    const raw = await client.generate(url, model, prompt, {
      stage: 'cc_transactions_live',
      temperature: 0,
      responseFormat: 'json',
      responseSchema: CC_TRANSACTIONS_SCHEMA,
      schemaName: 'cc_transactions',
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    });

    const parsed = parseLLMJsonResponse<{ transactions: Array<{ type: string; amount: number }> }>(raw);
    expect(Array.isArray(parsed.transactions)).toBe(true);
    expect(parsed.transactions.length).toBeGreaterThan(0);
    for (const t of parsed.transactions) {
      expect(['debit', 'credit']).toContain(t.type);
      expect(typeof t.amount).toBe('number');
    }
  }, 600_000);
});
