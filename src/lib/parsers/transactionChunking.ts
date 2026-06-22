import type { ExtractedTransaction } from '@/types/extractedTransaction';
import { debugLog } from '@/lib/utils/debug';
import { CHARS_PER_TOKEN, calculateMaxItems } from '@/lib/llm/contextWindow';

const CHUNK_TRIGGER_CHAR_THRESHOLD = 12000;
const CHUNK_TRIGGER_LINE_THRESHOLD = 250;
const CHUNK_TARGET_LINE_COUNT = 180;
const CHUNK_OVERLAP_LINE_COUNT = 12;

// Linear-coupled sizing (spec §6) — the "item" is a line: each input line yields input tokens
// (its chars) and output tokens (the extracted JSON it produces). Per-line estimates are
// starting values (spec §13) — calibrate live.
const AVG_CHARS_PER_LINE = 55;
const INPUT_TOKENS_PER_LINE = AVG_CHARS_PER_LINE / CHARS_PER_TOKEN; // ≈ 24
const OUTPUT_TOKENS_PER_LINE = 5; // extracted-JSON tokens per input line (~15/txn ÷ ~3 lines/txn)
// Fixed (non-variable) input for a transactions chunk: the system prompt + transactions
// template instructions, measured ~2500 tokens for cc_transactions via token-budget
// instrumentation. Passed to calculateMaxItems as the F in i + o ≤ C.
const TRANSACTIONS_PROMPT_OVERHEAD_TOKENS = 2500;

export interface TransactionChunkPlan {
  chunkingUsed: boolean;
  chunkTriggerReason: 'single_shot' | 'char_threshold' | 'line_threshold' | 'char_and_line_threshold';
  normalizedTextLength: number;
  normalizedLineCount: number;
  contextWindowTokens?: number;
  chunks: TransactionChunk[];
}

export interface TransactionChunk {
  index: number;
  totalChunks: number;
  startLine: number;
  endLine: number;
  lineCount: number;
  isFirst: boolean;
  isLast: boolean;
  overlapStartLine: number | null;
  text: string;
}

export interface ChunkRunDiagnostics {
  chunkIndex: number;
  startLine: number;
  endLine: number;
  lineCount: number;
  retriesAttempted: number;
  success: boolean;
  extractedTransactionCount: number;
  droppedTransactionCount: number;
  warnings: string[];
  errors: string[];
}

export interface MergedChunkTransactions {
  transactions: ExtractedTransaction[];
  duplicatesRemoved: number;
  conflictsResolved: number;
}

export function createTransactionChunkPlan(normalizedText: string, contextWindowTokens?: number): TransactionChunkPlan {
  const lines = normalizedText.split('\n');
  const normalizedTextLength = normalizedText.length;
  const normalizedLineCount = lines.length;

  let charThreshold: number;
  let lineThreshold: number;
  let targetLineCount: number;

  if (contextWindowTokens) {
    // Linear-coupled sizing (spec §6): each line adds input (its chars) and output (the
    // extracted JSON it yields). Max lines that fit, given the measured prompt overhead.
    const maxLines = calculateMaxItems(
      contextWindowTokens,
      TRANSACTIONS_PROMPT_OVERHEAD_TOKENS,
      INPUT_TOKENS_PER_LINE,
      OUTPUT_TOKENS_PER_LINE,
    ) ?? 0;
    const budgetLines = Math.max(maxLines, 1);
    const budgetChars = Math.floor(budgetLines * AVG_CHARS_PER_LINE);
    charThreshold = budgetChars;
    lineThreshold = budgetLines;
    targetLineCount = budgetLines;
  } else {
    charThreshold = CHUNK_TRIGGER_CHAR_THRESHOLD;
    lineThreshold = CHUNK_TRIGGER_LINE_THRESHOLD;
    targetLineCount = CHUNK_TARGET_LINE_COUNT;
  }

  const exceedsCharThreshold = normalizedTextLength > charThreshold;
  const exceedsLineThreshold = normalizedLineCount > lineThreshold;

  let chunkTriggerReason: TransactionChunkPlan['chunkTriggerReason'] = 'single_shot';
  if (exceedsCharThreshold && exceedsLineThreshold) {
    chunkTriggerReason = 'char_and_line_threshold';
  } else if (exceedsCharThreshold) {
    chunkTriggerReason = 'char_threshold';
  } else if (exceedsLineThreshold) {
    chunkTriggerReason = 'line_threshold';
  }

  if (chunkTriggerReason === 'single_shot') {
    return {
      chunkingUsed: false,
      chunkTriggerReason,
      normalizedTextLength,
      normalizedLineCount,
      contextWindowTokens,
      chunks: [
        {
          index: 0,
          totalChunks: 1,
          startLine: 0,
          endLine: Math.max(lines.length - 1, 0),
          lineCount: lines.length,
          isFirst: true,
          isLast: true,
          overlapStartLine: null,
          text: normalizedText,
        },
      ],
    };
  }

  const chunks: TransactionChunk[] = [];
  let startLine = 0;

  while (startLine < lines.length) {
    const endExclusive = Math.min(startLine + targetLineCount, lines.length);
    const chunkLines = lines.slice(startLine, endExclusive);
    const overlapStartLine = startLine === 0 ? null : startLine;

    chunks.push({
      index: chunks.length,
      totalChunks: 0,
      startLine,
      endLine: Math.max(endExclusive - 1, startLine),
      lineCount: chunkLines.length,
      isFirst: startLine === 0,
      isLast: endExclusive >= lines.length,
      overlapStartLine,
      text: chunkLines.join('\n'),
    });

    if (endExclusive >= lines.length) {
      break;
    }

    startLine = Math.max(endExclusive - CHUNK_OVERLAP_LINE_COUNT, startLine + 1);
  }

  const totalChunks = chunks.length;
  const finalizedChunks = chunks.map((chunk, index) => ({
    ...chunk,
    index,
    totalChunks,
    isFirst: index === 0,
    isLast: index === totalChunks - 1,
  }));

  return {
    chunkingUsed: true,
    chunkTriggerReason,
    normalizedTextLength,
    normalizedLineCount,
    contextWindowTokens,
    chunks: finalizedChunks,
  };
}

function normalizeDescription(description: string | undefined): string {
  return (description ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildTransactionSignature(tx: ExtractedTransaction): string {
  return [
    tx.date ?? '',
    String(tx.amount ?? ''),
    tx.type ?? '',
    normalizeDescription(tx.description),
    tx.originalCurrency ?? '',
    tx.originalAmount !== undefined ? String(tx.originalAmount) : '',
  ].join('|');
}

function getConfidence(tx: ExtractedTransaction): number {
  return typeof tx.confidence === 'number' ? tx.confidence : -1;
}

function buildConflictKey(tx: ExtractedTransaction): string {
  return [
    tx.date ?? '',
    tx.type ?? '',
    normalizeDescription(tx.description),
    tx.originalCurrency ?? '',
  ].join('|');
}

export function mergeChunkTransactions(transactions: ExtractedTransaction[]): MergedChunkTransactions {
  // Pass 1: Exact signature dedup
  const bySignature = new Map<string, ExtractedTransaction>();
  let duplicatesRemoved = 0;

  for (const tx of transactions) {
    const signature = buildTransactionSignature(tx);
    const existing = bySignature.get(signature);

    if (!existing) {
      bySignature.set(signature, tx);
      continue;
    }

    duplicatesRemoved++;
    const kept = getConfidence(tx) > getConfidence(existing) ? tx : existing;
    const dropped = kept === tx ? existing : tx;
    debugLog('chunkMerge', [
      'Duplicate from chunk overlap: same transaction extracted by multiple chunks',
      `  Kept:    ${kept.date} | ${kept.description} | ${kept.amount} ${kept.type} | confidence ${getConfidence(kept)}`,
      `  Dropped: ${dropped.date} | ${dropped.description} | ${dropped.amount} ${dropped.type} | confidence ${getConfidence(dropped)}`,
    ].join('\n'));
    if (getConfidence(tx) > getConfidence(existing)) {
      bySignature.set(signature, tx);
    }
  }

  // Pass 2: Conflict resolution for chunk overlap.
  // Same date + type + description but different amount means the LLM
  // extracted the same overlap-zone transaction inconsistently across chunks.
  // Keep the higher-confidence extraction.
  const byConflictKey = new Map<string, ExtractedTransaction[]>();
  for (const tx of bySignature.values()) {
    const key = buildConflictKey(tx);
    const group = byConflictKey.get(key) ?? [];
    group.push(tx);
    byConflictKey.set(key, group);
  }

  const result: ExtractedTransaction[] = [];
  let conflictsResolved = 0;

  for (const group of byConflictKey.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    conflictsResolved += group.length - 1;
    const winner = group.reduce((best, tx) =>
      getConfidence(tx) > getConfidence(best) ? tx : best,
    );
    const losers = group.filter(tx => tx !== winner);
    debugLog('chunkMerge', [
      'Amount conflict from chunk overlap: same transaction extracted with different amounts',
      `  Kept:    ${winner.date} | ${winner.description} | ${winner.amount} ${winner.type} | confidence ${getConfidence(winner)}`,
      ...losers.map(t => `  Dropped: ${t.date} | ${t.description} | ${t.amount} ${t.type} | confidence ${getConfidence(t)}`),
    ].join('\n'));
    result.push(winner);
  }

  return {
    transactions: result,
    duplicatesRemoved,
    conflictsResolved,
  };
}

export function getDroppedTransactionCount(debugInfo: unknown): number {
  if (!debugInfo || typeof debugInfo !== 'object') {
    return 0;
  }

  const maybeDebug = debugInfo as {
    droppedTransactions?: Array<unknown>;
  };

  return Array.isArray(maybeDebug.droppedTransactions)
    ? maybeDebug.droppedTransactions.length
    : 0;
}
