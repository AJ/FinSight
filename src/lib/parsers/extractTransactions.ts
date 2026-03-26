/**
 * Transaction extraction pass.
 *
 * Extracts all individual transaction rows from statement.
 */

import type { ExtractedTransaction } from '@/types/extractedTransaction';
import { CC_TRANSACTIONS_PROMPT, BANK_TRANSACTIONS_PROMPT } from './prompts';

export type { ExtractedTransaction };
export interface TransactionsOutput {
  transactions: ExtractedTransaction[];
  _debug?: {
    totalCount: number;
    droppedTransactions: Array<{
      reason: string;
      rawText: string;
    }>;
  };
}

/**
 * Build transaction extraction prompt.
 */
export function buildTransactionsPrompt(
  normalizedText: string,
  statementType: 'credit_card' | 'bank'
): string {
  const promptTemplate = statementType === 'credit_card'
    ? CC_TRANSACTIONS_PROMPT
    : BANK_TRANSACTIONS_PROMPT;
  
  return promptTemplate.replace('{RAW_TEXT}', normalizedText);
}
