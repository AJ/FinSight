import type { ExtractedTransaction } from '@/types/extractedTransaction';
import { debugLog } from '@/lib/utils/debug';
import { calculateMaxItems, estimateTokens, fitsSingleShot, getInputCharsPerToken, getOutputTokensPerInputLine } from '@/lib/llm/contextWindow';

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
  transactionRowCount?: number,
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

    // Single-shot row budget (spec 2026-08-28): only transaction rows
    // produce output, so with a known row count the whole text fits when
    // overhead + full input + per-row output stay inside the window. The
    // per-line reserve below over-counts ~3x on statements where most lines
    // (headers, footers, wrapped fragments) emit no output. Falls through to
    // per-line chunking when even this accounting overflows, and is skipped
    // entirely when the row count is unknown.
    if (transactionRowCount !== undefined) {
      const inputTokens = estimateTokens(normalizedText);
      const outputTokens = transactionRowCount * getOutputTokensPerInputLine();
      // Non-null: guardAligned guarantees contextWindowTokens is defined.
      if (fitsSingleShot(contextWindowTokens!, overheadTokens, inputTokens, outputTokens)) {
        return singleShotPlan(normalizedText, lines, normalizedTextLength, normalizedLineCount, contextWindowTokens);
      }
    }
    const maxLines = calculateMaxItems(
      contextWindowTokens,
      overheadTokens,
      inputTokensPerLine,
      getOutputTokensPerInputLine(),
    ) ?? 0;
    const maxChars = Math.floor(maxLines * avgCharsPerLine);

    // Reserve room for one header line injected into later chunks AFTER sizing
    // (row-identity spec §1/§3): any single line of this statement plus its
    // joining newline and a little slack. Without the reserve, a chunk sized
    // exactly to budget plus a header line can trip the pre-flight overflow
    // guard — a hard import failure that would not otherwise happen.
    const longestLine = lines.reduce((max, l) => Math.max(max, l.length), 0);
    const headerReserve = longestLine + 2;
    const reservedMaxChars = Math.max(maxChars - headerReserve, Math.floor(avgCharsPerLine) || 1);

    // Overhead alone exceeds the window (e.g. CC template ≈ 4.2K tokens vs a 4K window): no
    // split can help. Emit one chunk; the guard will surface it as model-too-small.
    if (maxChars <= 0) {
      return singleShotPlan(normalizedText, lines, normalizedTextLength, normalizedLineCount, contextWindowTokens);
    }

    // Whole text fits the guard's variable budget → one shot. (A single chunk is
    // never injected — the whole text already contains the header — so the
    // reserve does not apply here.)
    if (normalizedTextLength <= maxChars) {
      return singleShotPlan(normalizedText, lines, normalizedTextLength, normalizedLineCount, contextWindowTokens);
    }

    // Char-budget chunking, snapped to line boundaries so transactions stay whole. Sizing by
    // chars (not a fixed line count) keeps each chunk under the guard regardless of how line
    // length varies within the statement. Overlap stays line-based for the dedup model.
    const chunks = chunkByCharBudget(lines, reservedMaxChars);
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

export function mergeChunkTransactions(transactions: ExtractedTransaction[]): MergedChunkTransactions {
  // Two collapse keys, in order of authority (row-identity spec §5/§6):
  // 1. sourceLine — two rows echoing the SAME line number are two reads of one
  //    statement row (chunk overlap), even when their fields disagree (the
  //    overlap copy mis-reads columns). Collapse to the higher-confidence read.
  //    Numbered rows NEVER enter signature dedup: identical fields on different
  //    lines are genuinely distinct rows (same-day same-merchant purchases).
  // 2. Exact signature (date|amount|type|description|originalCurrency|originalAmount) —
  //    the fallback for rows where the model echoed no number. Same semantics as
  //    before: keep the higher-confidence read, count the rest as duplicates.
  const bySourceLine = new Map<number, ExtractedTransaction>();
  const bySignature = new Map<string, ExtractedTransaction>();
  // Keep the first-seen position of every surviving row. The previous
  // implementation returned the two maps one after the other, which moved
  // every numberless row to the end of the statement whenever even one row
  // had a sourceLine.
  const order: Array<
    | { kind: 'sourceLine'; key: number }
    | { kind: 'signature'; key: string }
  > = [];
  let duplicatesRemoved = 0;

  const better = (a: ExtractedTransaction, b: ExtractedTransaction): ExtractedTransaction =>
    getConfidence(b) > getConfidence(a) ? b : a;

  for (const tx of transactions) {
    if (typeof tx.sourceLine === 'number' && Number.isFinite(tx.sourceLine)) {
      const existing = bySourceLine.get(tx.sourceLine);
      if (!existing) {
        bySourceLine.set(tx.sourceLine, tx);
        order.push({ kind: 'sourceLine', key: tx.sourceLine });
        continue;
      }
      duplicatesRemoved++;
      const kept = better(existing, tx);
      const dropped = kept === existing ? tx : existing;
      debugLog('chunkMerge', [
        'Same sourceLine extracted twice (chunk overlap) — collapsed by line number',
        `  Kept:    ${kept.date} | ${kept.description} | ${kept.amount} ${kept.type} | confidence ${getConfidence(kept)}`,
        `  Dropped: ${dropped.date} | ${dropped.description} | ${dropped.amount} ${dropped.type} | confidence ${getConfidence(dropped)}`,
      ].join('\n'));
      bySourceLine.set(tx.sourceLine, kept);
      continue;
    }

    const signature = buildTransactionSignature(tx);
    const existing = bySignature.get(signature);
    if (!existing) {
      bySignature.set(signature, tx);
      order.push({ kind: 'signature', key: signature });
      continue;
    }
    duplicatesRemoved++;
    const kept = better(existing, tx);
    const dropped = kept === existing ? tx : existing;
    debugLog('chunkMerge', [
      'Duplicate from chunk overlap: same transaction extracted by multiple chunks (signature match, no sourceLine)',
      `  Kept:    ${kept.date} | ${kept.description} | ${kept.amount} ${kept.type} | confidence ${getConfidence(kept)}`,
      `  Dropped: ${dropped.date} | ${dropped.description} | ${dropped.amount} ${dropped.type} | confidence ${getConfidence(dropped)}`,
    ].join('\n'));
    bySignature.set(signature, kept);
  }

  return {
    transactions: order.map((entry) =>
      entry.kind === 'sourceLine'
        ? bySourceLine.get(entry.key)!
        : bySignature.get(entry.key)!,
    ),
    duplicatesRemoved,
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
