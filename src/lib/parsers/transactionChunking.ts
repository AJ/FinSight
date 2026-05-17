import type { ExtractedTransaction } from '@/types/extractedTransaction';
import { debugLog } from '@/lib/utils/debug';

const CHUNK_TRIGGER_CHAR_THRESHOLD = 12000;
const CHUNK_TRIGGER_LINE_THRESHOLD = 250;
const CHUNK_TARGET_LINE_COUNT = 180;
const CHUNK_OVERLAP_LINE_COUNT = 12;

export interface TransactionChunkPlan {
  chunkingUsed: boolean;
  chunkTriggerReason: 'single_shot' | 'char_threshold' | 'line_threshold' | 'char_and_line_threshold';
  normalizedTextLength: number;
  normalizedLineCount: number;
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

export function createTransactionChunkPlan(normalizedText: string): TransactionChunkPlan {
  const lines = normalizedText.split('\n');
  const normalizedTextLength = normalizedText.length;
  const normalizedLineCount = lines.length;
  const exceedsCharThreshold = normalizedTextLength > CHUNK_TRIGGER_CHAR_THRESHOLD;
  const exceedsLineThreshold = normalizedLineCount > CHUNK_TRIGGER_LINE_THRESHOLD;

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
    const endExclusive = Math.min(startLine + CHUNK_TARGET_LINE_COUNT, lines.length);
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
