/**
 * Transaction as returned by LLM extraction.
 * 
 * This DTO represents the raw LLM output shape - external data only.
 * Do NOT include internal fields like llmConfidence or verificationConfidence.
 */
export interface ExtractedTransaction {
  date: string;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
  transactionSubType?: string;
  balance?: number | null;
  localCurrency?: string;
  isInternationalTransaction?: boolean;
  originalCurrency?: string;
  originalAmount?: number;
  confidence?: number;
}
