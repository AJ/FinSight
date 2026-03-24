/**
 * Multi-pass statement extraction pipeline.
 * 
 * Orchestrates the extraction of financial data from statements using
 * independent passes for summary, transactions, and rewards.
 * 
 * Flow:
 * 1. Normalize raw text
 * 2. Detect statement type (CC or Bank)
 * 3. Run extraction passes (sequentially for local LLMs)
 * 4. Validate each pass output
 * 5. Retry failed passes with feedback
 * 6. Merge outputs (dedupe, reconcile, validate)
 * 7. Return final structured data
 */

import { normalizeStatementText } from './normalization';
import { detectStatementType } from './typeDetection';
import { buildSummaryPrompt } from './extractSummary';
import { buildTransactionsPrompt } from './extractTransactions';
import { buildRewardsPrompt } from './extractRewards';
import { mergeOutputs } from '../verification/mergeEngine';
import { runWithRetry } from './retryEngine';
import { validateCCSummary, validateBankSummary, validateTransactions } from '../verification/validationEngine';
import type { FinalOutput } from '../verification/mergeEngine';
import type { CCSummary, BankSummary } from './extractSummary';
import type { TransactionsOutput } from './extractTransactions';
import type { RewardsOutput } from './extractRewards';

const CONFIDENCE_THRESHOLD = 0.8;
const MAX_RETRIES = 3;

export interface PipelineResult {
  success: boolean;
  data: FinalOutput | null;
  warnings: string[];
  errors: string[];
}

/**
 * Main pipeline entry point.
 * 
 * @param rawText - Raw text extracted from PDF/statement
 * @returns Structured statement data or error
 */
export async function processStatement(rawText: string): Promise<PipelineResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    // Step 1: Normalize
    const normalized = normalizeStatementText(rawText);

    // Step 2: Detect statement type
    const typeResult = await detectStatementType(normalized);
    
    if (typeResult.confidence < CONFIDENCE_THRESHOLD) {
      return {
        success: false,
        data: null,
        warnings: [],
        errors: [
          `Statement type detection confidence (${typeResult.confidence}) below threshold (${CONFIDENCE_THRESHOLD}). ` +
          'Manual type selection required.'
        ]
      };
    }

    const statementType = typeResult.statementType;

    // Step 3: Run extraction passes based on type
    if (statementType === 'credit_card') {
      return processCreditCard(normalized);
    } else {
      return processBank(normalized);
    }

  } catch (e: unknown) {
    errors.push(`Pipeline failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    return {
      success: false,
      data: null,
      warnings,
      errors
    };
  }
}

/**
 * Credit card statement pipeline.
 * Three passes: Summary → Transactions → Rewards
 */
async function processCreditCard(normalizedText: string): Promise<PipelineResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Pass 1: Summary extraction
  const summaryPrompt = buildSummaryPrompt(normalizedText, 'credit_card');
  const summaryResult = await runWithRetry(
    summaryPrompt,
    normalizedText,
    validateCCSummary,
    {
      maxRetries: MAX_RETRIES,
      stage: 'cc_summary',
      maxTokens: 2048,
      onValidationFailure: (parsed) => {
        const s = parsed as CCSummary;
        console.log('[RetryEngine cc_summary] Validation failed. LLM returned:', {
          statementDate: s?.statementDate,
          paymentDueDate: s?.paymentDueDate,
          totalDue: s?.totalDue,
          previousBalance: s?.previousBalance,
          purchasesAndCharges: s?.purchasesAndCharges,
          paymentsReceived: s?.paymentsReceived,
        });
      }
    }
  );

  if (!summaryResult.success) {
    warnings.push(`Summary extraction had issues: ${summaryResult.errors.join(', ')}`);
  }

  // Pass 2: Transaction extraction
  const transactionsPrompt = buildTransactionsPrompt(normalizedText, 'credit_card');
  const transactionsResult = await runWithRetry(
    transactionsPrompt,
    normalizedText,
    validateTransactions,
    {
      maxRetries: MAX_RETRIES,
      stage: 'cc_transactions',
      maxTokens: 12288,
      onValidationFailure: (parsed) => {
        const t = parsed as TransactionsOutput;
        console.log('[RetryEngine cc_transactions] Validation failed. LLM returned:', {
          transactionCount: t?.transactions?.length,
        });
      }
    }
  );

  if (!transactionsResult.success) {
    errors.push(`Transaction extraction failed: ${transactionsResult.errors.join(', ')}`);
  }

  // Pass 3: Rewards extraction (CC only)
  const rewardsPrompt = buildRewardsPrompt(normalizedText);
  const rewardsResult = rewardsPrompt
    ? await runWithRetry(
        rewardsPrompt,
        normalizedText,
        (data: unknown) => ({ valid: true, errors: [], warnings: [], data: data as RewardsOutput }), // Lenient validation
        { maxRetries: MAX_RETRIES, stage: 'cc_rewards', maxTokens: 1024 }
      )
    : { success: true, data: null, errors: [], warnings: [], attempts: 0 };

  if (!rewardsResult.success) {
    warnings.push(`Rewards extraction had issues: ${rewardsResult.errors.join(', ')}`);
  }

  // Step 6: Merge outputs
  const merged = mergeOutputs(
    'credit_card',
    summaryResult.data,
    transactionsResult.data,
    rewardsResult.data,
    warnings
  );

  return {
    success: errors.length === 0,
    data: merged,
    warnings: merged.meta.warnings,
    errors
  };
}

/**
 * Bank statement pipeline.
 * Two passes: Summary → Transactions (no rewards)
 */
async function processBank(normalizedText: string): Promise<PipelineResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Pass 1: Summary extraction
  const summaryPrompt = buildSummaryPrompt(normalizedText, 'bank');
  const summaryResult = await runWithRetry(
    summaryPrompt,
    normalizedText,
    validateBankSummary,
    {
      maxRetries: MAX_RETRIES,
      stage: 'bank_summary',
      maxTokens: 2048,
      onValidationFailure: (parsed) => {
        const s = parsed as BankSummary;
        console.log('[RetryEngine bank_summary] Validation failed. LLM returned:', {
          statementDate: s?.statementDate,
          openingBalance: s?.openingBalance,
          closingBalance: s?.closingBalance,
        });
      }
    }
  );

  if (!summaryResult.success) {
    warnings.push(`Summary extraction had issues: ${summaryResult.errors.join(', ')}`);
  }

  // Pass 2: Transaction extraction
  const transactionsPrompt = buildTransactionsPrompt(normalizedText, 'bank');
  const transactionsResult = await runWithRetry(
    transactionsPrompt,
    normalizedText,
    validateTransactions,
    {
      maxRetries: MAX_RETRIES,
      stage: 'bank_transactions',
      maxTokens: 12288,
      onValidationFailure: (parsed) => {
        const t = parsed as TransactionsOutput;
        console.log('[RetryEngine bank_transactions] Validation failed. LLM returned:', {
          transactionCount: t?.transactions?.length,
        });
      }
    }
  );

  if (!transactionsResult.success) {
    errors.push(`Transaction extraction failed: ${transactionsResult.errors.join(', ')}`);
  }

  // Step 6: Merge outputs (no rewards for bank)
  const merged = mergeOutputs(
    'bank',
    summaryResult.data,
    transactionsResult.data,
    null,
    warnings
  );

  return {
    success: errors.length === 0,
    data: merged,
    warnings: merged.meta.warnings,
    errors
  };
}
