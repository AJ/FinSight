/**
 * Transaction extraction prompt + output type.
 *
 * Builds the prompt that asks the LLM to extract individual transaction rows,
 * and defines the TransactionsOutput shape. The actual LLM call and response
 * parsing happen in pipeline.ts (processBank / processCreditCard).
 */

import type { ExtractedTransaction } from '@/types/extractedTransaction';
import { CC_TRANSACTIONS_PROMPT, BANK_TRANSACTIONS_PROMPT } from './prompts';

export type { ExtractedTransaction };

export interface TransactionsOutput {
  transactions: ExtractedTransaction[];
  // Side-channel: bank statements only. The transaction pass reads opening/closing balance
  // from the labelled boundary rows of the transaction table. Absent for credit-card statements
  // and for error/middle-chunk outputs.
  openingBalance?: number | null;
  closingBalance?: number | null;
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
  statementType: 'credit_card' | 'bank',
  bankName?: string | null,
): string {
  const bankContext = bankName ? ` issued by ${bankName.toUpperCase()}` : '';
  const promptTemplate = statementType === 'credit_card'
    ? CC_TRANSACTIONS_PROMPT
    : BANK_TRANSACTIONS_PROMPT;

  return promptTemplate
    .replace('{RAW_TEXT}', normalizedText)
    .replace('{BANK_CONTEXT}', bankContext);
}
