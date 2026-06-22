/**
 * Statement type detection.
 *
 * Analyzes normalized text and determines if it's a credit card or bank statement.
 * Returns type + confidence score.
 */

import { getClient } from '@/lib/llm/index';
import { LLMError } from '@/lib/llm/types';
import type { LLMRuntimeConfig } from '@/lib/llm/types';
import { calculateMaxOutputTokens, overflowKind } from '@/lib/llm/contextWindow';
import { EXTRACTION_SYSTEM_PROMPT } from '@/lib/llm/prompts';
import { parseLLMJsonResponse } from '@/lib/utils/llm-response-parser';
import { TYPE_DETECTION_PROMPT, TYPE_DETECTION_SCHEMA } from './prompts';

export interface TypeDetectionResult {
  statementType: 'credit_card' | 'bank';
  confidence: number;
  reason: string;
  bankName: string | null;
}

function normalizeTypeValue(type: unknown): 'credit_card' | 'bank' | 'unknown' {
  const normalized = String(type || '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');

  const typeMap: Record<string, 'credit_card' | 'bank' | 'unknown'> = {
    credit_card: 'credit_card',
    credit_card_statement: 'credit_card',
    cc: 'credit_card',
    card: 'credit_card',
    creditcard: 'credit_card',
    bank: 'bank',
    bank_statement: 'bank',
    savings: 'bank',
    current: 'bank',
    checking: 'bank',
    unknown: 'unknown',
  };

  return typeMap[normalized] || 'unknown';
}

export async function detectStatementType(
  normalizedText: string,
  llmConfig: LLMRuntimeConfig,
  signal?: AbortSignal,
  contextWindowTokens?: number,
): Promise<TypeDetectionResult> {
  const contextSlice = normalizedText.length > 1000
    ? `${normalizedText.slice(0, 500)}\n\n... [document truncated for brevity] ...\n\n${normalizedText.slice(-500)}`
    : normalizedText;

  const prompt = TYPE_DETECTION_PROMPT.replace('{RAW_TEXT}', contextSlice);
  // Budget on the full input actually sent (system prompt + stage prompt) — consistency rule, spec §6.
  const maxOutputTokens = calculateMaxOutputTokens(contextWindowTokens, `${EXTRACTION_SYSTEM_PROMPT}\n\n${prompt}`);

  // Preflight overflow: the budget guard returns 0 when the full input already fills the
  // window. Bail with a classified LLMError (spec §7) before the doomed call — this is the
  // pipeline entry point; if it can't run, nothing downstream can.
  if (maxOutputTokens === 0) {
    throw new LLMError(
      `Type detection prompt exceeds the model's context window (${contextWindowTokens} tokens).`,
      overflowKind(contextWindowTokens),
    );
  }

  const client = getClient(llmConfig.provider);
  const rawResponse = await client.generate(
    llmConfig.baseUrl,
    llmConfig.model,
    prompt,
    { stage: 'type_detection', maxOutputTokens, contextWindow: contextWindowTokens, responseFormat: 'json', responseSchema: TYPE_DETECTION_SCHEMA, schemaName: 'statement_type', systemPrompt: EXTRACTION_SYSTEM_PROMPT, signal },
  );

  try {
    const parsed = parseLLMJsonResponse<{ type: string; confidence: number; reason?: string; bankName?: string }>(rawResponse);
    const normalizedType = normalizeTypeValue(parsed.type);

    if (normalizedType === 'unknown') {
      throw new Error(`Unknown statement type: ${parsed.type}`);
    }

    const rawBank = parsed.bankName;
    const bankName = rawBank && rawBank.toLowerCase() !== 'unknown' ? rawBank : null;

    return {
      statementType: normalizedType,
      confidence: parsed.confidence,
      reason: parsed.reason || '',
      bankName,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unknown statement type')) {
      throw error;
    }

    console.error('[Type Detection] Failed to parse LLM response:', rawResponse);
    throw new Error(
      `Type detection failed. LLM returned invalid response: "${rawResponse.slice(0, 100)}...". ` +
      'Please manually select the statement type and try again.'
    );
  }
}
