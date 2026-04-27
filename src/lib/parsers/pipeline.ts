/**
 * Multi-pass statement extraction pipeline.
 *
 * Orchestrates the extraction of financial data from statements using
 * independent passes for summary, transactions, and rewards.
 */

import type { LLMRuntimeConfig } from '@/lib/llm/types';
import { debugLog, debugWarn } from '@/lib/utils/debug';
import type { ExtractedTransaction } from '@/types/extractedTransaction';
import type { TransactionSubType } from '@/models/Transaction';
import { Transaction as CanonicalTransaction } from '@/models/Transaction';
import { SourceType } from '@/types';
import type { Currency, StatementFormat, Transaction } from '@/types';
import { normalizeStatementText } from './normalization';
import { detectStatementType } from './typeDetection';
import { buildSummaryPrompt } from './extractSummary';
import { buildTransactionsPrompt } from './extractTransactions';
import { buildRewardsPrompt } from './extractRewards';
import type { CCSummary, BankSummary, Summary } from './extractSummary';
import type { TransactionsOutput } from './extractTransactions';
import type { RewardsOutput } from './extractRewards';
import type { StatementExtractionData } from './extractionResult';
import { mergeOutputs } from '../verification/mergeEngine';
import { runWithRetry } from './retryEngine';
import { validateCCSummary, validateBankSummary, validateTransactions } from '../verification/validationEngine';
import type { ExtractionBundle, VerificationInputs } from './contracts';
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
  data: ExtractionBundle | null;
  warnings: string[];
  errors: string[];
}

type PipelineStatementType = 'credit_card' | 'bank';

interface ProcessOptions {
  format: StatementFormat;
  defaultCurrency: Currency;
  fileName: string;
  statementType?: PipelineStatementType;
  signal?: AbortSignal;
  llmConfig: LLMRuntimeConfig;
}

function buildFailedChunks(diagnostics: ChunkRunDiagnostics[]): string[] | undefined {
  const totalChunks = diagnostics.length;
  const failedChunks = diagnostics
    .filter((diagnostic) => !diagnostic.success)
    .map(
      (diagnostic) =>
        `Chunk ${diagnostic.chunkIndex + 1}/${totalChunks} (lines ${diagnostic.startLine + 1}-${diagnostic.endLine + 1})`,
    );

  return failedChunks.length > 0 ? failedChunks : undefined;
}

export async function processStatement(
  rawText: string,
  options: ProcessOptions,
): Promise<PipelineResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    const normalized = normalizeStatementText(rawText);

    let resolvedStatementType: PipelineStatementType;
    let bankName: string | null = null;
    if (options.statementType) {
      resolvedStatementType = options.statementType;
    } else {
      const typeResult = await detectStatementType(normalized, options.llmConfig, options.signal);
      bankName = typeResult.bankName;

      if (typeResult.confidence < CONFIDENCE_THRESHOLD) {
        return {
          success: false,
          data: null,
          warnings: [],
          errors: [
            `Statement type detection confidence (${typeResult.confidence}) below threshold (${CONFIDENCE_THRESHOLD}). Manual type selection required.`,
          ],
        };
      }

      resolvedStatementType = typeResult.statementType;
    }

    if (resolvedStatementType === 'credit_card') {
      return await processCreditCard(normalized, bankName || null, options);
    }

    return await processBank(normalized, bankName || null, options);
  } catch (e: unknown) {
    errors.push(`Pipeline failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    return {
      success: false,
      data: null,
      warnings,
      errors,
    };
  }
}

async function processCreditCard(
  normalizedText: string,
  bankName: string | null,
  options: ProcessOptions,
): Promise<PipelineResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const summaryPrompt = buildSummaryPrompt(normalizedText, 'credit_card', bankName);
  const summaryResult = await runWithRetry(
    summaryPrompt,
    normalizedText,
    validateCCSummary,
    {
      maxRetries: MAX_RETRIES,
      stage: 'cc_summary',
      maxTokens: 2048,
      signal: options.signal,
      llmConfig: options.llmConfig,
      onValidationFailure: (parsed) => {
        const s = parsed as CCSummary;
        debugLog('cc_summary', 'Validation failed. LLM returned:', {
          statementDate: s?.statementDate,
          paymentDueDate: s?.paymentDueDate,
          totalDue: s?.totalDue,
          previousBalance: s?.previousBalance,
          purchasesAndCharges: s?.purchasesAndCharges,
          paymentsReceived: s?.paymentsReceived,
        });
      },
    },
  );

  if (!summaryResult.success) {
    warnings.push(`Summary extraction had issues: ${summaryResult.errors.join(', ')}`);
  }

  const transactionsResult = await runTransactionExtraction(
    normalizedText,
    'credit_card',
    bankName,
    options.llmConfig,
    options.signal,
  );
  warnings.push(...transactionsResult.warnings);

  if (!transactionsResult.success) {
    errors.push(`Transaction extraction failed: ${transactionsResult.errors.join(', ')}`);
  }

  const rewardsPrompt = buildRewardsPrompt(normalizedText);
  const rewardsResult = rewardsPrompt
    ? await runWithRetry(
        rewardsPrompt,
        normalizedText,
        (data: unknown) => ({ valid: true, errors: [], warnings: [], data: data as RewardsOutput }),
        {
          maxRetries: MAX_RETRIES,
          stage: 'cc_rewards',
          maxTokens: 1024,
          signal: options.signal,
          llmConfig: options.llmConfig,
        },
      )
    : { success: true, data: null, errors: [], warnings: [], attempts: 0 };

  if (!rewardsResult.success) {
    warnings.push(`Rewards extraction had issues: ${rewardsResult.errors.join(', ')}`);
  }

  const failedChunks = transactionsResult.debugInfo && typeof transactionsResult.debugInfo === 'object'
    ? buildFailedChunks((transactionsResult.debugInfo as { diagnostics?: ChunkRunDiagnostics[] }).diagnostics ?? [])
    : undefined;

  const merged = mergeOutputs(
    'credit_card',
    summaryResult.data,
    transactionsResult.data,
    rewardsResult.data,
    warnings,
    failedChunks,
  );

  const data = buildExtractionBundle({
    rawText: normalizedText,
    statementType: 'credit_card',
    extracted: merged,
    defaultCurrency: options.defaultCurrency,
    format: options.format,
    fileName: options.fileName,
  });

  return {
    success: errors.length === 0,
    data,
    warnings: data.warnings,
    errors,
  };
}

async function processBank(
  normalizedText: string,
  bankName: string | null,
  options: ProcessOptions,
): Promise<PipelineResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const summaryPrompt = buildSummaryPrompt(normalizedText, 'bank', bankName);
  const summaryResult = await runWithRetry(
    summaryPrompt,
    normalizedText,
    validateBankSummary,
    {
      maxRetries: MAX_RETRIES,
      stage: 'bank_summary',
      maxTokens: 2048,
      signal: options.signal,
      llmConfig: options.llmConfig,
      onValidationFailure: (parsed) => {
        const s = parsed as BankSummary;
        debugLog('bank_summary', 'Validation failed. LLM returned:', {
          statementDate: s?.statementDate,
          openingBalance: s?.openingBalance,
          closingBalance: s?.closingBalance,
        });
      },
    },
  );

  if (!summaryResult.success) {
    warnings.push(`Summary extraction had issues: ${summaryResult.errors.join(', ')}`);
  }

  const transactionsResult = await runTransactionExtraction(
    normalizedText,
    'bank',
    bankName,
    options.llmConfig,
    options.signal,
  );
  warnings.push(...transactionsResult.warnings);

  if (!transactionsResult.success) {
    errors.push(`Transaction extraction failed: ${transactionsResult.errors.join(', ')}`);
  }

  const failedChunks = transactionsResult.debugInfo && typeof transactionsResult.debugInfo === 'object'
    ? buildFailedChunks((transactionsResult.debugInfo as { diagnostics?: ChunkRunDiagnostics[] }).diagnostics ?? [])
    : undefined;

  const merged = mergeOutputs(
    'bank',
    summaryResult.data,
    transactionsResult.data,
    null,
    warnings,
    failedChunks,
  );

  const data = buildExtractionBundle({
    rawText: normalizedText,
    statementType: 'bank',
    extracted: merged,
    defaultCurrency: options.defaultCurrency,
    format: options.format,
    fileName: options.fileName,
  });

  return {
    success: errors.length === 0,
    data,
    warnings: data.warnings,
    errors,
  };
}

async function runTransactionExtraction(
  normalizedText: string,
  statementType: 'credit_card' | 'bank',
  bankName: string | null,
  llmConfig: LLMRuntimeConfig,
  signal?: AbortSignal,
) {
  const stage = statementType === 'credit_card' ? 'cc_transactions' : 'bank_transactions';

  if (statementType === 'credit_card') {
    const transactionsPrompt = buildTransactionsPrompt(normalizedText, statementType, bankName);
    return runWithRetry(
      transactionsPrompt,
      normalizedText,
      validateTransactions,
      {
        maxRetries: MAX_RETRIES,
        stage,
        maxTokens: 12288,
        signal,
        llmConfig,
        onValidationFailure: (parsed) => {
          const t = parsed as TransactionsOutput;
          debugLog(stage, 'Validation failed. LLM returned:', {
            transactionCount: t?.transactions?.length,
          });
        },
      },
    );
  }

  const chunkPlan = createTransactionChunkPlan(normalizedText);

  if (!chunkPlan.chunkingUsed) {
    const transactionsPrompt = buildTransactionsPrompt(normalizedText, statementType, bankName);
    return runWithRetry(
      transactionsPrompt,
      normalizedText,
      validateTransactions,
      {
        maxRetries: MAX_RETRIES,
        stage,
        maxTokens: 12288,
        signal,
        llmConfig,
        onValidationFailure: (parsed) => {
          const t = parsed as TransactionsOutput;
          debugLog(stage, 'Validation failed. LLM returned:', {
            transactionCount: t?.transactions?.length,
          });
        },
      },
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
    const transactionsPrompt = buildTransactionsPrompt(chunk.text, statementType, bankName);
    const chunkResult = await runWithRetry(
      transactionsPrompt,
      chunk.text,
      validateTransactions,
      {
        maxRetries: MAX_RETRIES,
        stage,
        maxTokens: 12288,
        signal,
        llmConfig,
        onValidationFailure: (parsed) => {
          const t = parsed as TransactionsOutput;
          debugLog(stage, `chunk ${chunk.index + 1}/${chunk.totalChunks} Validation failed. LLM returned:`, {
            transactionCount: t?.transactions?.length,
          });
        },
      },
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
      transactionErrors.push(`Chunk ${chunk.index + 1}/${chunk.totalChunks} failed: ${chunkResult.errors.join(', ')}`);
    }

    if (chunkResult.warnings.length > 0) {
      transactionWarnings.push(`Chunk ${chunk.index + 1}/${chunk.totalChunks}: ${chunkResult.warnings.join(', ')}`);
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

const cashbackKeywords = ['cashback', 'valueback', 'reward cash', 'reward cashback'];
const ccPaymentKeywords = [
  'credit card',
  'cc payment',
  'card payment',
  'hdfc card',
  'icici card',
  'axis card',
  'sbi card',
  'kotak card',
  'citi card',
  'amex card',
  'idfc card',
  'tele-transfer',
  'tele transfer',
  'neft-hdfc',
  'neft-icici',
  'neft-axis',
  'neft-sbi',
  'neft-kotak',
  'billdesk*hdfc',
  'billdesk*icici',
  'billdesk*axis',
  'autopay cc',
];
const ccIssuers = [
  'hdfc',
  'icici',
  'axis',
  'sbi',
  'kotak',
  'citi',
  'amex',
  'idfc',
  'au bank',
  'bob',
  'canara',
  'pnb',
  'hsbc',
  'standard chartered',
  'scb',
  'rbl',
  'yes bank',
];

function normalizeCCTransactionSubTypes(transactions: Transaction[]): Transaction[] {
  return transactions.map((transaction) => {
    if (transaction.sourceType !== SourceType.CreditCard) {
      return transaction;
    }
    if (!transaction.isCredit) {
      return transaction;
    }
    if (transaction.transactionSubType !== 'bill_payment') {
      return transaction;
    }

    const text = `${transaction.description} ${transaction.originalText ?? ''}`.toLowerCase();
    const looksLikeCashback = cashbackKeywords.some((keyword) => text.includes(keyword));
    const looksLikeBillPayment =
      ccPaymentKeywords.some((keyword) => text.includes(keyword)) ||
      ccIssuers.some(
        (issuer) => text.includes(issuer) && (text.includes('card') || text.includes('bill')),
      );

    if (looksLikeCashback || looksLikeBillPayment) {
      return transaction;
    }

    return new CanonicalTransaction(
      transaction.id,
      transaction.date,
      transaction.description,
      transaction.amount,
      transaction.type,
      transaction.category,
      transaction.balance,
      transaction.merchant,
      transaction.originalText,
      transaction.budgetMonth,
      transaction.categoryConfidence,
      transaction.needsReview,
      transaction.categorizedBy,
      transaction.sourceType,
      transaction.statementId,
      transaction.cardIssuer,
      transaction.cardLastFour,
      transaction.cardHolder,
      transaction.localCurrency,
      transaction.originalCurrency,
      transaction.originalAmount,
      transaction.isInternational,
      transaction.isAnomaly,
      transaction.anomalyTypes,
      transaction.anomalyDetails,
      transaction.anomalyDismissed,
      'refund' as TransactionSubType,
      transaction.suggestedCategory,
      transaction.llmConfidence,
      transaction.verificationConfidence,
    );
  });
}

function toCanonicalTransactions(
  extractedTransactions: ExtractedTransaction[],
  defaultCurrency: Currency,
  sourceType: SourceType,
): Transaction[] {
  const transactions = extractedTransactions.map((transaction) =>
    CanonicalTransaction.fromExtracted(transaction, defaultCurrency, sourceType),
  );

  return sourceType === SourceType.CreditCard
    ? normalizeCCTransactionSubTypes(transactions)
    : transactions;
}

function buildVerificationInputs(
  rawText: string,
  statementType: 'bank' | 'credit_card',
  transactions: Transaction[],
  currency: Currency,
  summary: Summary | null,
): VerificationInputs | undefined {
  if (statementType === 'bank' && summary && 'openingBalance' in summary) {
    const bankSummary = summary as BankSummary;
    return {
      kind: 'bank',
      rawText,
      transactions,
      meta: {
        openingBalance: bankSummary.openingBalance ?? undefined,
        closingBalance: bankSummary.closingBalance ?? undefined,
        currency: currency.code,
      },
      summary: bankSummary,
    };
  }

  if (statementType === 'credit_card' && summary && 'totalDue' in summary) {
    const ccSummary = summary as CCSummary;
    return {
      kind: 'credit_card',
      rawText,
      transactions,
      meta: {
        previousBalance: ccSummary.previousBalance ?? undefined,
        totalDue: ccSummary.totalDue ?? undefined,
        paymentsReceived: ccSummary.paymentsReceived ?? undefined,
        purchasesAndCharges: ccSummary.purchasesAndCharges ?? undefined,
        interestCharged: ccSummary.interestCharged ?? undefined,
        lateFee: ccSummary.lateFee ?? undefined,
        otherCharges: ccSummary.otherCharges ?? undefined,
        cashbackEarned: ccSummary.cashbackEarned ?? undefined,
        currency: currency.code,
      },
      summary: ccSummary,
    };
  }

  return undefined;
}

function buildExtractionBundle(input: {
  rawText: string;
  statementType: 'bank' | 'credit_card';
  extracted: StatementExtractionData;
  defaultCurrency: Currency;
  format: StatementFormat;
  fileName: string;
}): ExtractionBundle {
  const validationResult = validateTransactions({ transactions: input.extracted.transactions });
  if (!validationResult.valid || !validationResult.data) {
    throw new Error(`Transaction validation failed: ${validationResult.errors.join(', ')}`);
  }

  const sourceType =
    input.statementType === 'credit_card' ? SourceType.CreditCard : SourceType.Bank;

  const validatedTransactions = validationResult.data.transactions;
  const withReasoning = validatedTransactions.filter((t) => t.reasoning);
  if (withReasoning.length > 0) {
    debugLog('[extraction] Transaction reasoning:', withReasoning.map((t) => ({
      description: t.description.substring(0, 50),
      type: t.type,
      subType: t.transactionSubType,
      amount: t.amount,
      reasoning: t.reasoning,
    })));
  }

  const transactions = toCanonicalTransactions(
    validationResult.data.transactions,
    input.defaultCurrency,
    sourceType,
  );
  const currency =
    transactions.find((transaction) => transaction.localCurrency)?.localCurrency ??
    input.defaultCurrency;
  const statementSummary = input.extracted.summary ?? null;

  return {
    transactions,
    currency,
    format: input.format,
    fileName: input.fileName,
    parseDate: new Date(),
    statementType: input.statementType,
    statementSummary,
    verificationInputs: buildVerificationInputs(
      input.rawText,
      input.statementType,
      transactions,
      currency,
      statementSummary,
    ),
    warnings: [...input.extracted.meta.warnings, ...validationResult.warnings],
    errors: [],
    parsingErrors: [],
    rawText: input.rawText,
    sourceMetadata: {
      failedChunks: input.extracted.meta.failedChunks,
    },
  };
}
