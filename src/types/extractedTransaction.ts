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
  reasoning?: string;
  type: 'debit' | 'credit';
  transactionSubType?: string;
  balance?: number | null;
  localCurrency?: string;
  isInternationalTransaction?: boolean;
  originalCurrency?: string;
  originalAmount?: number;
  confidence?: number;
  /**
   * 1-based line number of the statement line this row was extracted from
   * (the `N||` prefix the transactions pass adds to every line). The row's
   * identity for chunk-overlap collapse and the verification line check.
   * Undefined when the model did not echo a number, and always undefined
   * for CSV/XLS imports (deterministic parsers, no chunking).
   */
  sourceLine?: number;
}
