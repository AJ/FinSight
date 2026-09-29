/**
 * Multi-pass statement extraction pipeline.
 *
 * Orchestrates the extraction of financial data from statements using
 * independent passes for summary, transactions, and rewards.
 */

import type { LLMRuntimeConfig } from '@/lib/llm/types';
import { getContextWindowInfo } from '@/lib/llm/contextWindow';
import { EXTRACTION_SYSTEM_PROMPT } from '@/lib/llm/prompts';
import { debugLog, debugWarn } from '@/lib/utils/debug';
import type { ExtractedTransaction } from '@/types/extractedTransaction';
import { Transaction as CanonicalTransaction } from '@/models/Transaction';
import { SourceType } from '@/types';
import type { Currency, StatementFormat, Transaction } from '@/types';
import { normalizeStatementText, normalizeStatementWithLineMap } from './normalization';
import { detectStatementType, ManualTypeSelectionError } from './typeDetection';
import { buildSummaryPrompt } from './extractSummary';
import { buildTransactionsPrompt } from './extractTransactions';
import { buildRewardsPrompt } from './extractRewards';
import {
  CC_SUMMARY_SCHEMA,
  CC_REWARDS_SCHEMA,
  CC_TRANSACTIONS_SCHEMA,
  BANK_SUMMARY_SCHEMA,
  BANK_TRANSACTIONS_SCHEMA,
} from './prompts';
import type { CCSummary, BankSummary, Summary } from './extractSummary';
import type { TransactionsOutput } from './extractTransactions';
import { pickBoundaryBalances, reconcileBalances } from './balanceReconcile';
import type { RewardsOutput } from './extractRewards';
import type { StatementExtractionData } from './extractionResult';
import { mergeOutputs } from '../verification/mergeEngine';
import { runWithRetry } from './retryEngine';
import { validateCCSummary, validateBankSummary, validateTransactions } from '../verification/validationEngine';
import type { ExtractionBundle, VerificationInputs } from './contracts';
import { normalizeCCTransactionSubTypes } from './ccPaymentDetection';
import {
  createTransactionChunkPlan,
  getDroppedTransactionCount,
  mergeChunkTransactions,
  type ChunkRunDiagnostics,
  type TransactionChunk,
} from './transactionChunking';
import { numberStatementLines, formatCreditCardTransactionInput } from './lineNumbering';
import { geometryHeaderForChunk, verifiedEchoHeader } from './chunkHeaderInjection';
import type { StatementTableInfo } from './extraction/extractionTypes';
import { extractDateFromText, DATE_MONTH_SEP } from './dateParser';

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
  tables?: StatementTableInfo[],
): Promise<PipelineResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    const mapped = tables?.length ? normalizeStatementWithLineMap(rawText) : null;
    const normalized = mapped?.text ?? normalizeStatementText(rawText);
    const translatedTables = translateTables(mapped?.lineMap ?? [], tables);

    const contextInfo = await getContextWindowInfo({
      provider: options.llmConfig.provider,
      baseUrl: options.llmConfig.baseUrl,
      model: options.llmConfig.model,
    });
    const contextWindowTokens = contextInfo.contextLength;

    let resolvedStatementType: PipelineStatementType;
    let bankName: string | null = null;
    if (options.statementType) {
      resolvedStatementType = options.statementType;
    } else {
      const typeResult = await detectStatementType(normalized, options.llmConfig, options.signal, contextWindowTokens);
      bankName = typeResult.bankName;

      const detectedType = typeResult.statementType;
      if (detectedType === 'unknown' || typeResult.confidence < CONFIDENCE_THRESHOLD) {
        throw new ManualTypeSelectionError(
          typeResult.reason ||
            `Statement type could not be determined (confidence ${typeResult.confidence}). Please select the statement type.`,
        );
      }

      resolvedStatementType = detectedType;
    }

    if (resolvedStatementType === 'credit_card') {
      return await processCreditCard(normalized, bankName || null, options, contextWindowTokens, translatedTables);
    }

    return await processBank(normalized, bankName || null, options, contextWindowTokens, translatedTables);
  } catch (e: unknown) {
    // Manual type selection is a recoverable outcome, not a pipeline failure —
    // propagate it unwrapped so the upload UI can re-prompt for the type.
    if (e instanceof ManualTypeSelectionError) throw e;
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
  contextWindowTokens?: number,
  tables: StatementTableInfo[] = [],
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
      contextWindowTokens,
      responseSchema: CC_SUMMARY_SCHEMA,
      schemaName: 'cc_summary',
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
    // Summary failure is a hard error (spec §9): balances are essential — verification
    // has no anchor without them — so a failed summary (overflow or validation) fails
    // the import rather than silently producing a statement with empty balances.
    errors.push(`Summary extraction failed: ${summaryResult.errors.join(', ')}`);
  }

  const transactionsResult = await runTransactionExtraction(
    normalizedText,
    'credit_card',
    bankName,
    options.llmConfig,
    options.signal,
    contextWindowTokens,
    tables,
  );
  warnings.push(...transactionsResult.warnings);

  if (!transactionsResult.success) {
    errors.push(`Transaction extraction failed: ${transactionsResult.errors.join(', ')}`);
  } else if (transactionsResult.errors.length > 0) {
    warnings.push(`Partial extraction: ${transactionsResult.errors.join(', ')}`);
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
          contextWindowTokens,
          responseSchema: CC_REWARDS_SCHEMA,
          schemaName: 'cc_rewards',
          signal: options.signal,
          llmConfig: options.llmConfig,
        },
      )
    : { success: true, data: null, errors: [], warnings: [], attempts: 0 };

  if (!rewardsResult.success) {
    // Rewards are non-essential — a failure (overflow or validation) stays a soft
    // warning and the import continues with null rewards (spec §9).
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
    warnings: [...warnings, ...data.warnings],
    errors,
  };
}

async function processBank(
  normalizedText: string,
  bankName: string | null,
  options: ProcessOptions,
  contextWindowTokens?: number,
  tables: StatementTableInfo[] = [],
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
      contextWindowTokens,
      responseSchema: BANK_SUMMARY_SCHEMA,
      schemaName: 'bank_summary',
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
    // Summary failure is a hard error (spec §9) — see processCreditCard for rationale.
    errors.push(`Summary extraction failed: ${summaryResult.errors.join(', ')}`);
  }

  const transactionsResult = await runTransactionExtraction(
    normalizedText,
    'bank',
    bankName,
    options.llmConfig,
    options.signal,
    contextWindowTokens,
    tables,
  );
  warnings.push(...transactionsResult.warnings);

  if (!transactionsResult.success) {
    errors.push(`Transaction extraction failed: ${transactionsResult.errors.join(', ')}`);
  } else if (transactionsResult.errors.length > 0) {
    warnings.push(`Partial extraction: ${transactionsResult.errors.join(', ')}`);
  }

  const failedChunks = transactionsResult.debugInfo && typeof transactionsResult.debugInfo === 'object'
    ? buildFailedChunks((transactionsResult.debugInfo as { diagnostics?: ChunkRunDiagnostics[] }).diagnostics ?? [])
    : undefined;

  // Reconcile opening/closing balance: the summary section's label/value grid scrambles under
  // PDF text flattening, so prefer the transaction pass's boundary-row values when they
  // self-validate (opening + credits - debits ≈ closing); otherwise fall back to the summary.
  // Overwriting the summary values here means the bundle, verificationInputs, and the recon
  // engine all see the corrected balance with no further changes.
  const txnData = transactionsResult.data;
  const txnTxns = txnData?.transactions ?? [];
  const totalDebits = txnTxns.filter((t) => t.type === 'debit').reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalCredits = txnTxns.filter((t) => t.type === 'credit').reduce((s, t) => s + Math.abs(t.amount), 0);
  const transactionsWithRunningBalance = txnTxns.filter((t) => typeof t.balance === 'number' && Number.isFinite(t.balance));
  // Running-balance fallback: derive opening by reversing the first balanced txn and closing
  // from the last. This assumes the array is in chronological (oldest-first) order, which is
  // NOT guaranteed — the extraction prompt does not enforce order and nothing sorts the result,
  // so a newest-first statement yields swapped values here. Tolerable because these are
  // priority-2 (weakest) candidates: a wrong-order pair fails reconcileBalances'
  // opening + credits - debits ≈ closing check and falls back to the labelled boundary rows or
  // summary. The only residual exposure is a statement with no boundary labels and a corrupted
  // summary (the rescue path this fallback exists for).
  const firstBalancedTxn = transactionsWithRunningBalance[0];
  const lastBalancedTxn = transactionsWithRunningBalance[transactionsWithRunningBalance.length - 1];
  const runningOpening = firstBalancedTxn
    ? firstBalancedTxn.type === 'debit'
      ? firstBalancedTxn.balance! + Math.abs(firstBalancedTxn.amount)
      : firstBalancedTxn.balance! - Math.abs(firstBalancedTxn.amount)
    : null;
  const runningClosing = lastBalancedTxn?.balance ?? null;
  const summaryData = summaryResult.data as BankSummary | null;
  const reconciled = reconcileBalances({
    summaryOpening: summaryData?.openingBalance ?? null,
    summaryClosing: summaryData?.closingBalance ?? null,
    txnOpening: txnData?.openingBalance ?? null,
    txnClosing: txnData?.closingBalance ?? null,
    runningOpening,
    runningClosing,
    totalDebits,
    totalCredits,
  });
  debugLog('bank_summary', 'Balance reconcile', {
    summary: { opening: summaryData?.openingBalance ?? null, closing: summaryData?.closingBalance ?? null },
    transactions: { opening: txnData?.openingBalance ?? null, closing: txnData?.closingBalance ?? null },
    running: { opening: runningOpening, closing: runningClosing },
    chosen: { opening: reconciled.openingBalance, closing: reconciled.closingBalance },
    sources: { opening: reconciled.openingSource, closing: reconciled.closingSource },
    warning: reconciled.warning ?? null,
  });
  if (summaryData) {
    // Only write a key when we actually have a value. Writing null would inject the key onto a
    // summary that lacked it, which falsely triggers verificationInputs (its gate is key presence).
    // A legitimate 0 is non-null and is written.
    if (reconciled.openingBalance !== null) summaryData.openingBalance = reconciled.openingBalance;
    if (reconciled.closingBalance !== null) summaryData.closingBalance = reconciled.closingBalance;
  }
  if (reconciled.warning) warnings.push(reconciled.warning);

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
    warnings: [...warnings, ...data.warnings],
    errors,
  };
}

/** Below this many lines a truncated chunk is not split further — the failure
 * is recorded loudly instead (a chunk this small truncating means the model
 * cannot finish even a handful of rows; smaller is not meaningfully safer). */
const MIN_SHRINK_LINES = 24;

/** Split a chunk in half at its line midpoint, keeping line-number metadata
 * continuous. Returns null when the chunk is at the shrink floor. */
function splitChunkInHalf(chunk: TransactionChunk): [TransactionChunk, TransactionChunk] | null {
  if (chunk.lineCount <= MIN_SHRINK_LINES) return null;
  const lines = chunk.text.split('\n');
  const mid = Math.ceil(lines.length / 2);
  return [
    { ...chunk, endLine: chunk.startLine + mid - 1, lineCount: mid, isLast: false, text: lines.slice(0, mid).join('\n') },
    { ...chunk, startLine: chunk.startLine + mid, overlapStartLine: null, isFirst: false, lineCount: lines.length - mid, text: lines.slice(mid).join('\n') },
  ];
}

async function runTransactionExtraction(
  normalizedText: string,
  statementType: 'credit_card' | 'bank',
  bankName: string | null,
  llmConfig: LLMRuntimeConfig,
  signal?: AbortSignal,
  contextWindowTokens?: number,
  tables: StatementTableInfo[] = [],
) {
  const stage = statementType === 'credit_card' ? 'cc_transactions' : 'bank_transactions';
  const responseSchema = statementType === 'credit_card' ? CC_TRANSACTIONS_SCHEMA : BANK_TRANSACTIONS_SCHEMA;
  const schemaName = stage;

  // Fixed prompt prefix the overflow guard sees minus the variable raw text: the system prompt
  // plus the transactions template with its {RAW_TEXT} placeholder removed ({BANK_CONTEXT}
  // resolved to the real bank name). Lets the chunker size each chunk to the guard's own budget.
  const overheadText = contextWindowTokens
    ? `${EXTRACTION_SYSTEM_PROMPT}\n\n${buildTransactionsPrompt('', statementType, bankName)}`
    : undefined;
  // Row identity (spec §2): number a LOCAL copy — only this pass ever sees
  // numbered text. Type detection, summary, rewards, and verification all
  // receive the original string.
  const numberedText = statementType === 'credit_card'
    ? formatCreditCardTransactionInput(normalizedText, tables)
    : numberStatementLines(normalizedText);
  const numberedLines = numberedText.split('\n');

  // A transaction row emits output; supporting prose normally does not. Prefer
  // the exact rows from the geometry detector, then use date-bearing lines when
  // geometry could not identify a table. An unknown count deliberately retains
  // the chunker's conservative per-line budget.
  const tableRowCount = tables.reduce((count, table) => count + table.dataRowLineIndexes.length, 0);
  const anchorRowCount = numberedLines.filter(
    line => extractDateFromText(line) !== null || DATE_MONTH_SEP.test(line),
  ).length;
  const transactionRowCount = tableRowCount > 0 ? tableRowCount : anchorRowCount > 0 ? anchorRowCount : undefined;
  const chunkPlan = createTransactionChunkPlan(
    numberedText,
    contextWindowTokens,
    overheadText,
    transactionRowCount,
  );

  // Full input dump for local-capture diagnostics (privacy: copy from the
  // browser console into a LOCAL file only). Emitted in slices: the user's
  // browser silently dropped the single full-statement entry while smaller
  // entries rendered fine, and the earlier partial capture was cut at ~7KB
  // the same way. ~60 lines per part keeps each entry chunk-dump-sized,
  // which demonstrably survives.
  {
    const dumpLines = numberedText.split('\n');
    const PART_SIZE = 60;
    const parts = Math.max(1, Math.ceil(dumpLines.length / PART_SIZE));
    for (let p = 0; p < parts; p++) {
      const slice = dumpLines.slice(p * PART_SIZE, (p + 1) * PART_SIZE).join('\n');
      debugLog(stage, `TRANSACTIONS-INPUT-DUMP part ${p + 1} of ${parts} (chunkingUsed=${chunkPlan.chunkingUsed}, totalChunks=${chunkPlan.chunks.length}):\n${slice}`);
    }
  }

  let plan = chunkPlan;
  if (!plan.chunkingUsed) {
    const transactionsPrompt = buildTransactionsPrompt(numberedText, statementType, bankName);
    const singleShot = await runWithRetry(
      transactionsPrompt,
      numberedText,
      validateTransactions,
      {
        maxRetries: MAX_RETRIES,
        stage,
        contextWindowTokens,
        responseSchema,
        schemaName,
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
    if (!(singleShot.success === false && singleShot.outputTruncated)) {
      return singleShot;
    }
    // Output truncation on the single shot: retrying the same size is doomed.
    // Fall back to the chunk loop starting from the text split in half (or
    // whole when at the floor); chunks that still truncate are split further
    // by the shrink loop.
    debugLog(stage, 'Single-shot extraction truncated at the output cap — falling back to chunked extraction');
    const halves = splitChunkInHalf(plan.chunks[0]);
    if (halves) {
      plan = { ...plan, chunkingUsed: true, chunks: halves };
    }
  }

  debugLog(stage, 'Adaptive chunking enabled', {
    reason: plan.chunkTriggerReason,
    normalizedTextLength: plan.normalizedTextLength,
    normalizedLineCount: plan.normalizedLineCount,
    contextWindowTokens: plan.contextWindowTokens,
    totalChunks: plan.chunks.length,
  });

  const diagnostics: ChunkRunDiagnostics[] = [];
  const allTransactions: ExtractedTransaction[] = [];
  const transactionWarnings: string[] = [];
  const transactionErrors: string[] = [];
  // Per-chunk outputs (for assembling opening/closing balance: first chunk owns opening, last
  // owns closing). Null entries for failed chunks.
  const chunkOutputs: Array<TransactionsOutput | null> = [];
  let totalAttempts = 0;
  let successfulChunks = 0;
  let contextOverflow = false;

  // First verified echoed header (fallback path, spec §3): once a chunk returns
  // a header line that verbatim-matches one of its own lines, every LATER chunk
  // that doesn't already contain that line gets it prepended.
  let echoHeader: string | null = null;

  // Detect-and-shrink work queue: a chunk whose output truncated (the model hit
  // its output-token cap) is split in half and both halves re-extracted. Below
  // the floor the failure is recorded loudly — never a silent partial import.
  const work: TransactionChunk[] = [...plan.chunks];

  for (let w = 0; w < work.length; w++) {
    const chunk = work[w];
    // Header injection (spec §3), one mechanism for both sources: geometry
    // header when the table was detected and this chunk covers its rows; else
    // the first verified echo. The header keeps its own line number, so the
    // model sees a repeat of an earlier line, not a new row.
    let header: string | null = geometryHeaderForChunk(chunk, tables, numberedLines);
    if (!header && echoHeader !== null) {
      const echoIdx = Number.parseInt(echoHeader, 10) - 1;
      const chunkContainsEcho =
        Number.isInteger(echoIdx) && echoIdx >= chunk.startLine && echoIdx <= chunk.endLine;
      if (!chunkContainsEcho) header = echoHeader;
    }
    const chunkText = header !== null ? `${header}\n${chunk.text}` : chunk.text;
    debugLog(stage, `TRANSACTIONS-CHUNK-DUMP (chunk ${w + 1} of ${work.length}):\n${chunkText}`);

    const transactionsPrompt = buildTransactionsPrompt(chunkText, statementType, bankName);
    const chunkResult = await runWithRetry(
      transactionsPrompt,
      chunkText,
      validateTransactions,
      {
        maxRetries: MAX_RETRIES,
        stage,
        contextWindowTokens,
        responseSchema,
        schemaName,
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

    // Truncated output: split this chunk in half and re-extract both halves.
    // The failed attempt is not recorded as a chunk failure — the halves carry
    // the content. At/below the floor, fall through to the loud failure path.
    if (!chunkResult.success && chunkResult.outputTruncated) {
      const halves = splitChunkInHalf(chunk);
      if (halves) {
        work.splice(w + 1, 0, halves[0], halves[1]);
        debugLog(stage, `Chunk output truncated (${chunk.lineCount} lines) — split into halves of ${halves[0].lineCount} and ${halves[1].lineCount} lines`);
        continue;
      }
      transactionErrors.push(`Chunk ${chunk.index + 1} output truncated at the minimum chunk size (${chunk.lineCount} lines) — its rows were NOT extracted`);
    }

    // Capture the first verified echo header (spec §3). A garbled echo is
    // logged and ignored — no injection, current behavior. When both sources
    // exist, geometry wins and a disagreement is logged for observability.
    if (echoHeader === null) {
      const echoed = chunkResult.data?.tableHeader ?? null;
      echoHeader = verifiedEchoHeader(echoed, chunk.text);
      if (echoed !== null && echoHeader === null) {
        debugLog(stage, 'Echoed tableHeader failed the verbatim whole-line check — not injecting', { echoed });
      }
      if (echoHeader !== null && header !== null && echoHeader.trim() !== header.trim()) {
        debugLog(stage, 'Geometry header and echoed header disagree — using geometry', { geometry: header, echoed: echoHeader });
      }
    }

    const extractedTransactions = chunkResult.data?.transactions ?? [];
    const droppedTransactionCount = getDroppedTransactionCount(chunkResult.debugInfo);
    chunkOutputs.push(chunkResult.success ? chunkResult.data ?? null : null);

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

    // Overflow propagates: every later chunk is at least as big, so it would overflow
    // too. Record it and stop — the caller treats transaction overflow as a hard failure.
    if (chunkResult.contextOverflow) {
      contextOverflow = true;
      transactionErrors.push(`Chunk ${chunk.index + 1}/${chunk.totalChunks} overflowed the context window`);
      break;
    }
  }

  const mergedTransactions = mergeChunkTransactions(allTransactions);
  const mergedValidation = validateTransactions({ transactions: mergedTransactions.transactions });

  // Assemble opening/closing balance from chunk boundary rows (first chunk's opening, last
  // chunk's closing). The re-validation above was passed only { transactions }, so its balance
  // fields are null — override them with the chunk-assembled values.
  const boundary = pickBoundaryBalances(chunkOutputs);
  const dataWithBalances = mergedValidation.data
    ? { ...mergedValidation.data, openingBalance: boundary.openingBalance, closingBalance: boundary.closingBalance }
    : mergedValidation.data;

  debugLog(stage, 'Chunked extraction summary', {
    chunkingUsed: true,
    chunkTriggerReason: plan.chunkTriggerReason,
    normalizedTextLength: plan.normalizedTextLength,
    normalizedLineCount: plan.normalizedLineCount,
    totalChunks: plan.chunks.length,
    extractionCalls: work.length,
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
    // Chunk failures become warnings (partial data is usable) but are NOT
    // silently discarded — they remain in warnings for downstream inspection.
    mergedWarnings.push(...transactionErrors);
    mergedWarnings.push(...mergedValidation.errors);
  }

  return {
    success: !contextOverflow && (hasUsableData || mergedErrors.length === 0),
    data: dataWithBalances,
    errors: mergedErrors,
    warnings: mergedWarnings,
    attempts: totalAttempts,
    contextOverflow,
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

  if (input.statementType === 'bank') {
    debugLog('[pipeline]', 'Bank summary (normalized):', {
      openingBalance: (input.extracted.summary as BankSummary)?.openingBalance,
      closingBalance: (input.extracted.summary as BankSummary)?.closingBalance,
      accountNumber: (input.extracted.summary as BankSummary)?.accountNumber,
      bankName: (input.extracted.summary as BankSummary)?.bankName,
    });
  }
  const validationResult = validateTransactions({ transactions: input.extracted.transactions });
  if (!validationResult.valid || !validationResult.data) {
    throw new Error(`Transaction validation failed: ${validationResult.errors.join(', ')}`);
  }

  const sourceType =
    input.statementType === 'credit_card' ? SourceType.CreditCard : SourceType.Bank;

  const validatedTransactions = validationResult.data.transactions;
  for (const t of validatedTransactions) {
    debugLog('extraction', `Transaction result: ${JSON.stringify({
      sourceLine: t.sourceLine,
      date: t.date,
      description: t.description,
      type: t.type,
      subType: t.transactionSubType,
      amount: t.amount,
      reasoning: t.reasoning,
    })}`);
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

function translateTables(
  lineMap: Array<number | null>,
  tables?: StatementTableInfo[],
): StatementTableInfo[] {
  if (!tables || tables.length === 0) return [];
  const translated: StatementTableInfo[] = [];
  for (const table of tables) {
    const headerLineIndex = lineMap[table.headerLineIndex];
    const dataRowLineIndexes = table.dataRowLineIndexes.map(index => lineMap[index])
      .filter((m): m is number => typeof m === 'number');
    if (headerLineIndex === null || headerLineIndex === undefined || dataRowLineIndexes.length === 0) {
      continue; // unusable table — skip; other tables may still map
    }
    translated.push({ headerLineIndex, dataRowLineIndexes, columns: table.columns });
  }
  return translated;
}
