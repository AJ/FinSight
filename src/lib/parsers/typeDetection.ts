/**
 * Statement type detection.
 * 
 * Analyzes normalized text and determines if it's a credit card or bank statement.
 * Returns type + confidence score.
 */

import { callLLM } from '../llm/llmClient';
import { TYPE_DETECTION_PROMPT } from './prompts';

export interface TypeDetectionResult {
  statementType: 'credit_card' | 'bank';
  confidence: number;
  reason: string;
}

export async function detectStatementType(normalizedText: string): Promise<TypeDetectionResult> {
  const prompt = TYPE_DETECTION_PROMPT.replace('{RAW_TEXT}', normalizedText);
  // const prompt = TYPE_DETECTION_PROMPT + normalizedText + '\n---\n\nAnalyze and return JSON:';
  
  const rawResponse = await callLLM(prompt, { stage: 'type_detection', maxTokens: 512 });

  try {
    const parsed = JSON.parse(rawResponse);
    return {
      statementType: parsed.type,
      confidence: parsed.confidence,
      reason: parsed.reason || ''
    };
  } catch {
    // Log the raw response for debugging
    console.error('[Type Detection] Failed to parse LLM response:', rawResponse);

    // Throw error - caller should prompt user for manual type selection
    throw new Error(
      `Type detection failed. LLM returned invalid response: "${rawResponse.slice(0, 100)}...". ` +
      'Please manually select the statement type and try again.'
    );
  }
}
