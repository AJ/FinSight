/**
 * Statement type detection.
 *
 * Analyzes normalized text and determines if it's a credit card or bank statement.
 * Returns type + confidence score.
 */

import { callLLM } from '../llm/llmClient';
import { parseLLMJsonResponse } from '@/lib/utils/llm-response-parser';
import { TYPE_DETECTION_PROMPT } from './prompts';

export interface TypeDetectionResult {
  statementType: 'credit_card' | 'bank';
  confidence: number;
  reason: string;
  bankName: string | null;
}

/**
 * Normalize the LLM's type value to canonical format.
 * Handles variations like "credit-card", "credit card", "CC", etc.
 */
function normalizeTypeValue(type: unknown): 'credit_card' | 'bank' | 'unknown' {
  const normalized = String(type || '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');  // "credit-card" → "credit_card", "credit card" → "credit_card"
  
  // Map common variations to canonical values
  const typeMap: Record<string, 'credit_card' | 'bank' | 'unknown'> = {
    // Credit card variations
    'credit_card': 'credit_card',
    'credit_card_statement': 'credit_card',
    'cc': 'credit_card',
    'card': 'credit_card',
    'creditcard': 'credit_card',
    
    // Bank variations
    'bank': 'bank',
    'bank_statement': 'bank',
    'savings': 'bank',
    'current': 'bank',
    'checking': 'bank',
    
    // Unknown/ambiguous
    'unknown': 'unknown',
  };
  
  return typeMap[normalized] || 'unknown';
}

export async function detectStatementType(normalizedText: string, signal?: AbortSignal): Promise<TypeDetectionResult> {
  // Add context slices (first 500 + last 500 chars) for better detection
  const contextSlice = normalizedText.length > 1000
    ? `${normalizedText.slice(0, 500)}\n\n... [document truncated for brevity] ...\n\n${normalizedText.slice(-500)}`
    : normalizedText;
  
  const prompt = TYPE_DETECTION_PROMPT.replace('{RAW_TEXT}', contextSlice);

  const rawResponse = await callLLM(prompt, { stage: 'type_detection', maxTokens: 512, signal });

  try {
    const parsed = parseLLMJsonResponse<{ type: string; confidence: number; reason?: string; bankName?: string }>(rawResponse);

    // Normalize the type value to handle LLM variations
    const normalizedType = normalizeTypeValue(parsed.type);

    // If type is unknown, throw error for manual selection
    if (normalizedType === 'unknown') {
      throw new Error(`Unknown statement type: ${parsed.type}`);
    }

    // Parse bank name (null if "unknown", null, or empty)
    const rawBank = parsed.bankName;
    const bankName = rawBank && rawBank.toLowerCase() !== 'unknown' ? rawBank : null;

    return {
      statementType: normalizedType,
      confidence: parsed.confidence,
      reason: parsed.reason || '',
      bankName,
    };
  } catch (error) {
    // Re-throw if it's our unknown type error
    if (error instanceof Error && error.message.includes('Unknown statement type')) {
      throw error;
    }
    
    // Log the raw response for debugging
    console.error('[Type Detection] Failed to parse LLM response:', rawResponse);

    // Throw error - caller should prompt user for manual type selection
    throw new Error(
      `Type detection failed. LLM returned invalid response: "${rawResponse.slice(0, 100)}...". ` +
      'Please manually select the statement type and try again.'
    );
  }
}
