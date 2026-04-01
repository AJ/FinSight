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
import { debugLog, debugWarn } from '@/lib/utils/debug';
import type { ExtractedTransaction } from '@/types/extractedTransaction';
import type { FinalOutput } from '../verification/mergeEngine';
import type { CCSummary, BankSummary } from './extractSummary';
import type { TransactionsOutput } from './extractTransactions';
import type { RewardsOutput } from './extractRewards';
import {
  createTransactionChunkPlan,
  getDroppedTransactionCount,
  mergeChunkTransactions,
  type ChunkRunDiagnostics,
} from './transactionChunking';

const CONFIDENCE_THRESHOLD = 0.8;
const MAX_RETRIES = 3;

export interface PipelineResult {
  success: boolean;
  data: FinalOutput | null;
  warnings: string[];
  errors: string[];
}

type PipelineStatementType = 'credit_card' | 'bank';

/**
 * Main pipeline entry point.
 * 
 * @param rawText - Raw text extracted from PDF/statement
 * @returns Structured statement data or error
 */
export async function processStatement(
  rawText: string,
  signal?: AbortSignal,
  statementType?: PipelineStatementType,
): Promise<PipelineResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    // Step 1: Normalize
    const normalized = normalizeStatementText(rawText);

    // Step 2: Detect statement type
    let resolvedStatementType: PipelineStatementType;
    if (statementType) {
      resolvedStatementType = statementType;
    } else {
      const typeResult = await detectStatementType(normalized, signal);
      
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

      resolvedStatementType = typeResult.statementType;
    }

    // Step 3: Run extraction passes based on type
    if (resolvedStatementType === 'credit_card') {
      return processCreditCard(normalized, signal);
    } else {
      return processBank(normalized, signal);
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
async function processCreditCard(normalizedText: string, signal?: AbortSignal): Promise<PipelineResult> {
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
        signal,
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
  const transactionsResult = await runTransactionExtraction(normalizedText, 'credit_card', signal);
  warnings.push(...transactionsResult.warnings);

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
        { maxRetries: MAX_RETRIES, stage: 'cc_rewards', maxTokens: 1024, signal }
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
async function processBank(normalizedText: string, signal?: AbortSignal): Promise<PipelineResult> {
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
        signal,
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
  const transactionsResult = await runTransactionExtraction(normalizedText, 'bank', signal);
  warnings.push(...transactionsResult.warnings);

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

async function runTransactionExtraction(
  normalizedText: string,
  statementType: 'credit_card' | 'bank',
  signal?: AbortSignal,
) {
  const stage = statementType === 'credit_card' ? 'cc_transactions' : 'bank_transactions';

  if (statementType === 'credit_card') {
    const transactionsPrompt = buildTransactionsPrompt(normalizedText, statementType);
    return runWithRetry(
      transactionsPrompt,
      normalizedText,
      validateTransactions,
      {
        maxRetries: MAX_RETRIES,
        stage,
        maxTokens: 12288,
        signal,
        onValidationFailure: (parsed) => {
          const t = parsed as TransactionsOutput;
          console.log(`[RetryEngine ${stage}] Validation failed. LLM returned:`, {
            transactionCount: t?.transactions?.length,
          });
        }
      }
    );
  }

  const chunkPlan = createTransactionChunkPlan(normalizedText);

  if (!chunkPlan.chunkingUsed) {
    const transactionsPrompt = buildTransactionsPrompt(normalizedText, statementType);
    return runWithRetry(
      transactionsPrompt,
      normalizedText,
      validateTransactions,
      {
        maxRetries: MAX_RETRIES,
        stage,
        maxTokens: 12288,
        signal,
        onValidationFailure: (parsed) => {
          const t = parsed as TransactionsOutput;
          console.log(`[RetryEngine ${stage}] Validation failed. LLM returned:`, {
            transactionCount: t?.transactions?.length,
          });
        }
      }
    );
  }

  debugLog(stage, 'Adaptive chunking enabled', {
    reason: chunkPlan.chunkTriggerReason,
    normalizedTextLength: chunkPlan.normalizedTextLength,
    normalizedLineCount: chunkPlan.normalizedLineCount,
    totalChunks: chunkPlan.chunks.length,
  });

  const diagnostics: ChunkRunDiagnostics[] = [];
  const allTransactions: ExtractedTransaction[] = [];
  const transactionWarnings: string[] = [];
  const transactionErrors: string[] = [];
  let totalAttempts = 0;
  let successfulChunks = 0;

  for (const chunk of chunkPlan.chunks) {
    const transactionsPrompt = buildTransactionsPrompt(chunk.text, statementType);
    const chunkResult = await runWithRetry(
      transactionsPrompt,
      chunk.text,
      validateTransactions,
      {
        maxRetries: MAX_RETRIES,
        stage,
        maxTokens: 12288,
        signal,
        onValidationFailure: (parsed) => {
          const t = parsed as TransactionsOutput;
          console.log(`[RetryEngine ${stage} chunk ${chunk.index + 1}/${chunk.totalChunks}] Validation failed. LLM returned:`, {
            transactionCount: t?.transactions?.length,
          });
        }
      }
    );

    totalAttempts += chunkResult.attempts;
    const extractedTransactions = chunkResult.data?.transactions ?? [];
    const droppedTransactionCount = getDroppedTransactionCount(chunkResult.debugInfo);

    diagnostics.push({
      chunkIndex: chunk.index,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      lineCount: chunk.lineCount,
      retriesAttempted: chunkResult.attempts,
      success: chunkResult.success,
      extractedTransactionCount: extractedTransactions.length,
      droppedTransactionCount,
      warnings: chunkResult.warnings,
      errors: chunkResult.errors,
    });

    allTransactions.push(...extractedTransactions);

    if (chunkResult.success) {
      successfulChunks++;
    } else {
      transactionErrors.push(
        `Chunk ${chunk.index + 1}/${chunk.totalChunks} failed: ${chunkResult.errors.join(', ')}`
      );
    }

    if (chunkResult.warnings.length > 0) {
      transactionWarnings.push(
        `Chunk ${chunk.index + 1}/${chunk.totalChunks}: ${chunkResult.warnings.join(', ')}`
      );
    }
  }

  const mergedTransactions = mergeChunkTransactions(allTransactions);
  const mergedValidation = validateTransactions({ transactions: mergedTransactions.transactions });

  debugLog(stage, 'Chunked extraction summary', {
    chunkingUsed: true,
    chunkTriggerReason: chunkPlan.chunkTriggerReason,
    normalizedTextLength: chunkPlan.normalizedTextLength,
    normalizedLineCount: chunkPlan.normalizedLineCount,
    totalChunks: chunkPlan.chunks.length,
    totalAttempts,
    successfulChunks,
    extractedBeforeDedupe: allTransactions.length,
    extractedAfterDedupe: mergedTransactions.transactions.length,
    duplicatesRemoved: mergedTransactions.duplicatesRemoved,
    diagnostics,
  });

  if (transactionErrors.length > 0) {
    debugWarn(stage, 'Some chunks failed during transaction extraction', transactionErrors);
  }

  const hasUsableData = mergedValidation.data !== null && mergedValidation.data.transactions.length > 0;
  const mergedWarnings = [...transactionWarnings, ...mergedValidation.warnings];
  const mergedErrors = [...transactionErrors, ...mergedValidation.errors];

  if (hasUsableData) {
    mergedWarnings.push(...transactionErrors);
    mergedWarnings.push(...mergedValidation.errors);
  }

  return {
    success: mergedErrors.length === 0 || hasUsableData,
    data: mergedValidation.data,
    errors: hasUsableData ? [] : mergedErrors,
    warnings: mergedWarnings,
    attempts: totalAttempts,
    debugInfo: {
      chunkingUsed: true,
      chunkTriggerReason: chunkPlan.chunkTriggerReason,
      normalizedTextLength: chunkPlan.normalizedTextLength,
      normalizedLineCount: chunkPlan.normalizedLineCount,
      totalChunks: chunkPlan.chunks.length,
      extractedBeforeDedupe: allTransactions.length,
      extractedAfterDedupe: mergedTransactions.transactions.length,
      duplicatesRemoved: mergedTransactions.duplicatesRemoved,
      diagnostics,
    },
  };
}
