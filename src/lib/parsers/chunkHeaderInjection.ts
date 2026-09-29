import type { TransactionChunk } from './transactionChunking';

/**
 * A transaction table located by the geometry path (row-identity spec §3), with
 * line indexes already translated to the NUMBERED normalized text (0-based).
 */
export interface GeometryTable {
  headerLineIndex: number;
  dataRowLineIndexes: number[];
}

/**
 * Geometry path: the header line to prepend to `chunk`, or null when the chunk
 * already contains the header or covers none of the table's rows. Deterministic
 * source — the geometry pipeline detected the table, no model involvement.
 */
export function geometryHeaderForChunk(
  chunk: Pick<TransactionChunk, 'startLine' | 'endLine'>,
  tables: GeometryTable[],
  numberedLines: string[],
): string | null {
  for (const table of tables) {
    const overlapsRows = table.dataRowLineIndexes.some(
      (idx) => idx >= chunk.startLine && idx <= chunk.endLine,
    );
    const containsHeader =
      table.headerLineIndex >= chunk.startLine && table.headerLineIndex <= chunk.endLine;
    const headerLine = numberedLines[table.headerLineIndex];
    if (overlapsRows && !containsHeader && headerLine !== undefined) {
      return headerLine;
    }
  }
  return null;
}

/**
 * Fallback path: the model echoes the header line; trust it only when it is a
 * WHOLE line of the chunk it was read from (row-identity spec §3). A whole-line
 * match necessarily includes the leading line number, keeping the every-line-
 * starts-with-its-number shape intact. Returns the trimmed line to prepend, or
 * null when the echo is absent or unverifiable (→ no injection, current
 * behavior).
 */
export function verifiedEchoHeader(
  echoed: string | null | undefined,
  chunkText: string,
): string | null {
  if (typeof echoed !== 'string') return null;
  const candidate = echoed.trim();
  if (candidate === '') return null;
  return chunkText.split('\n').some((line) => line === candidate) ? candidate : null;
}
