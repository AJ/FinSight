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
  // Side-channel: the transaction table's header line, copied exactly (including
  // its leading line number) by the model in the first chunk that sees it. Used
  // to inject the header into later chunks on the fallback path (no table
  // geometry). Null when no header row was visible in the chunk.
  tableHeader?: string | null;
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
    .replace('{BANK_CONTEXT}', () => bankContext)
    .replace('{RAW_TEXT}', () => normalizedText);
}
