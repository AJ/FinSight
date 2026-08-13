import type { ExtractedTransaction } from '@/types/extractedTransaction';
import { debugLog } from '@/lib/utils/debug';
import { calculateMaxItems, estimateTokens, getInputCharsPerToken, getOutputTokensPerInputLine } from '@/lib/llm/contextWindow';

// Static (guard-skipped) path: used when the context window is unknown, so there is no
// overflow budget to honor — chunking here is purely for LLM attention/friendliness.
const CHUNK_TRIGGER_CHAR_THRESHOLD = 12000;
const CHUNK_TRIGGER_LINE_THRESHOLD = 250;
const CHUNK_TARGET_LINE_COUNT = 180;
// Overlap (both paths): consecutive chunks re-include this many tail lines so a transaction
// split across a boundary is captured by both and de-duplicated by mergeChunkTransactions.
const CHUNK_OVERLAP_LINE_COUNT = 12;

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

/**
 * Plan how to split `normalizedText` into chunks for transaction extraction.
 *
 * Two regimes:
 *  - **Guard-aligned** (preferred): when `contextWindowTokens` AND `overheadText` are both
 *    supplied, chunks are sized in CHARACTERS against the same budget the pre-flight overflow
 *    guard enforces (`maxVariableInputChars`, the inverse of `calculateMaxOutputTokens`).
 *    Every chunk this regime emits is guaranteed to pass the guard — there is no parallel
 *    estimate to drift out of sync. `overheadText` is the fixed prompt prefix the guard sees
 *    minus the variable text (system prompt + transactions template with `{RAW_TEXT}` removed).
 *  - **Static** (guard skipped): when the context window is unknown, there is no overflow
 *    budget to honor, so chunking uses fixed char/line thresholds purely for LLM attention.
 *
 * When `contextWindowTokens` is provided, `overheadText` MUST be provided too — otherwise the
 * guard is active but the chunker cannot size against it, so the call falls back to the static
 * regime (which may not satisfy the guard). The sole production caller (pipeline.ts) always
 * passes both.
 */
export function createTransactionChunkPlan(
  normalizedText: string,
  contextWindowTokens?: number,
  overheadText?: string,
): TransactionChunkPlan {
  const lines = normalizedText.split('\n');
  const normalizedTextLength = normalizedText.length;
  const normalizedLineCount = lines.length;

  const guardAligned = !!contextWindowTokens && overheadText !== undefined;

  if (guardAligned) {
    // Measure the REAL average chars/line from this statement's text, instead of assuming a
    // fixed width. The overflow guard measures actual characters, so the per-chunk budget must
    // too — a line-based budget keyed off an assumed chars/line drifts from the guard whenever
    // real lines are longer (which they routinely are: merchant + city + amount + currency).
    const avgCharsPerLine = normalizedLineCount > 0 ? normalizedTextLength / normalizedLineCount : 0;
    const inputTokensPerLine = avgCharsPerLine / getInputCharsPerToken();

    // Linear-coupled budget (i + o ≤ C): real per-pass overhead + per-line input + per-line
    // output. This reserves output room (the guard returns 0 not only on input overflow but
    // also when input leaves no generation room), which a pure input budget misses.
    const overheadTokens = estimateTokens(overheadText!);
    const maxLines = calculateMaxItems(
      contextWindowTokens,
      overheadTokens,
      inputTokensPerLine,
      getOutputTokensPerInputLine(),
    ) ?? 0;
    const maxChars = Math.floor(maxLines * avgCharsPerLine);

    // Overhead alone exceeds the window (e.g. CC template ≈ 4.2K tokens vs a 4K window): no
    // split can help. Emit one chunk; the guard will surface it as model-too-small.
    if (maxChars <= 0) {
      return singleShotPlan(normalizedText, lines, normalizedTextLength, normalizedLineCount, contextWindowTokens);
    }

    // Whole text fits the guard's variable budget → one shot.
    if (normalizedTextLength <= maxChars) {
      return singleShotPlan(normalizedText, lines, normalizedTextLength, normalizedLineCount, contextWindowTokens);
    }

    // Char-budget chunking, snapped to line boundaries so transactions stay whole. Sizing by
    // chars (not a fixed line count) keeps each chunk under the guard regardless of how line
    // length varies within the statement. Overlap stays line-based for the dedup model.
    const chunks = chunkByCharBudget(lines, maxChars);
    return {
      chunkingUsed: true,
      chunkTriggerReason: 'char_threshold',
      normalizedTextLength,
      normalizedLineCount,
      contextWindowTokens,
      chunks: finalize(chunks),
    };
  }

  // Static regime (guard skipped / window unknown).
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
    return singleShotPlan(normalizedText, lines, normalizedTextLength, normalizedLineCount, contextWindowTokens);
  }

  const chunks = chunkByLineCount(lines, CHUNK_TARGET_LINE_COUNT);
  return {
    chunkingUsed: true,
    chunkTriggerReason,
    normalizedTextLength,
    normalizedLineCount,
    contextWindowTokens,
    chunks: finalize(chunks),
  };
}

// Cost of a line within a chunk: its chars + the '\n' that rejoins it to its neighbours.
// (join uses one fewer separator than lines; counting one per line over-budgets by a single
// char per chunk — the safe direction for a ceiling.)
function lineCost(line: string): number {
  return line.length + 1;
}

function singleShotPlan(
  text: string,
  lines: string[],
  normalizedTextLength: number,
  normalizedLineCount: number,
  contextWindowTokens?: number,
): TransactionChunkPlan {
  return {
    chunkingUsed: false,
    chunkTriggerReason: 'single_shot',
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
        text,
      },
    ],
  };
}

/**
 * Greedily accumulate lines into each chunk while the running char cost stays at or below
 * `maxChars`. At least one line is always included — even a single line that alone exceeds
 * the budget (unavoidable; the guard surfaces it as input-too-large). Consecutive chunks
 * overlap by CHUNK_OVERLAP_LINE_COUNT lines.
 */
function chunkByCharBudget(lines: string[], maxChars: number): TransactionChunk[] {
  const chunks: TransactionChunk[] = [];
  let startLine = 0;

  while (startLine < lines.length) {
    let endExclusive = startLine + 1;
    let used = lineCost(lines[startLine]);
    while (endExclusive < lines.length && used + lineCost(lines[endExclusive]) <= maxChars) {
      used += lineCost(lines[endExclusive]);
      endExclusive++;
    }

    const chunkLines = lines.slice(startLine, endExclusive);
    chunks.push(buildChunk(chunks.length, startLine, endExclusive, chunkLines));

    if (endExclusive >= lines.length) break;
    startLine = Math.max(endExclusive - CHUNK_OVERLAP_LINE_COUNT, startLine + 1);
  }

  return chunks;
}

function chunkByLineCount(lines: string[], targetLineCount: number): TransactionChunk[] {
  const chunks: TransactionChunk[] = [];
  let startLine = 0;

  while (startLine < lines.length) {
    const endExclusive = Math.min(startLine + targetLineCount, lines.length);
    const chunkLines = lines.slice(startLine, endExclusive);
    chunks.push(buildChunk(chunks.length, startLine, endExclusive, chunkLines));

    if (endExclusive >= lines.length) break;
    startLine = Math.max(endExclusive - CHUNK_OVERLAP_LINE_COUNT, startLine + 1);
  }

  return chunks;
}

function buildChunk(
  index: number,
  startLine: number,
  endExclusive: number,
  chunkLines: string[],
): TransactionChunk {
  return {
    index,
    totalChunks: 0,
    startLine,
    endLine: Math.max(endExclusive - 1, startLine),
    lineCount: chunkLines.length,
    isFirst: false,
    isLast: false,
    overlapStartLine: startLine === 0 ? null : startLine,
    text: chunkLines.join('\n'),
  };
}

function finalize(chunks: TransactionChunk[]): TransactionChunk[] {
  const totalChunks = chunks.length;
  return chunks.map((chunk, index) => ({
    ...chunk,
    index,
    totalChunks,
    isFirst: index === 0,
    isLast: index === totalChunks - 1,
  }));
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
