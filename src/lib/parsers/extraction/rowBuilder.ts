import type { AssignedLine, LogicalRow, ColumnSchema, ColumnDef } from './extractionTypes';
import { isDateLike } from '../datePatterns';

// Opening markers appear BEFORE transactions (skip row, continue processing)
const OPENING_MARKERS = ['opening balance', 'brought forward'];
// Closing markers appear AFTER transactions (stop processing — end of table)
const CLOSING_MARKERS = ['closing balance', 'carried forward', 'total'];

/**
 * Checks if a row is noise by exact/standalone matching — the marker must be
 * the entire cell content (after trimming punctuation/whitespace), not a substring.
 * This avoids false positives like "Total gas purchase" matching "total".
 */
function classifyNoiseRow(values: string[]): 'opening' | 'closing' | null {
  const normalized = values.map(v =>
    v.toLowerCase().replace(/[:.\s]+$/g, '').trim(),
  );
  for (const v of normalized) {
    if (OPENING_MARKERS.includes(v)) return 'opening';
    if (CLOSING_MARKERS.includes(v)) return 'closing';
  }
  return null;
}

/**
 * Structural detection of summary/total rows: no date + ≥2 numeric values
 * in non-date columns + ALL non-empty non-date values must be numeric.
 * The "all numeric" requirement distinguishes summary rows from continuation
 * lines — a continuation has description text (non-numeric), but a bare summary
 * row has only amounts. Safe to run on any line without false positives.
 */
function isSummaryRow(values: string[], dateColIdx: number): boolean {
  // Must NOT have a date
  if (values[dateColIdx] && isDateLike(values[dateColIdx])) return false;

  // Count numeric values and check for any non-numeric text in non-date columns
  let numericCount = 0;
  let hasNonNumericText = false;
  for (let i = 0; i < values.length; i++) {
    if (i === dateColIdx) continue;
    const v = values[i].trim();
    if (!v) continue;
    const cleaned = v.replace(/[, ]/g, '');
    if (/^\d+(\.\d+)?$/.test(cleaned)) {
      numericCount++;
    } else {
      hasNonNumericText = true;
    }
  }

  // Summary rows: ≥2 numeric columns AND no description text at all
  return numericCount >= 2 && !hasNonNumericText;
}

function getSchemaForRegion(schemas: ColumnSchema[], regionIndex: number): ColumnSchema | undefined {
  return schemas.find(s => s.sourceRegionIndex === regionIndex);
}

function deriveXBounds(schema: ColumnSchema): { startX: number; endX: number } {
  const startX = Math.min(...schema.columns.map(c => c.columnLeft));
  const endX = Math.max(...schema.columns.map(c => c.columnRight));
  return { startX, endX };
}

function buildValues(line: AssignedLine): string[] {
  const values: string[] = [];
  const numCols = Math.max(...line.assignments, 0) + 1;
  for (let i = 0; i < numCols; i++) values.push('');
  for (let i = 0; i < line.line.items.length; i++) {
    const colIdx = line.assignments[i];
    const text = line.line.items[i].text;
    values[colIdx] = values[colIdx] ? values[colIdx] + ' ' + text : text;
  }
  return values;
}

function appendToRow(row: LogicalRow, values: string[]): void {
  for (let i = 0; i < values.length; i++) {
    if (values[i]) {
      row.columnValues[i] = row.columnValues[i]
        ? row.columnValues[i] + ' ' + values[i]
        : values[i];
    }
  }
}

function prependToRow(row: LogicalRow, values: string[]): void {
  for (let i = 0; i < values.length; i++) {
    if (values[i]) {
      row.columnValues[i] = row.columnValues[i]
        ? values[i] + ' ' + row.columnValues[i]
        : values[i];
    }
  }
}

export interface TableRegionMeta {
  regionIndex: number;
  /** Pages this region spans (PDFs can have continued tables across pages) */
  pages: Set<number>;
  started: boolean;
  ended: boolean;
  /** Y of first data row (opening balance, first anchor, or opening noise row) */
  startY: number | null;
  /** Y of closing noise/summary row, or last anchor if no closing marker */
  endY: number | null;
  /** Leftmost column bound (derived from schema) */
  startX: number;
  /** Rightmost column bound (derived from schema) */
  endX: number;
}

export interface BuildTransactionRowsResult {
  rows: LogicalRow[];
  /** Per-region table metadata, keyed by regionIndex */
  regionMeta: Map<number, TableRegionMeta>;
  /** Lines after the table end in each region (post-table metadata, footers, etc.) */
  postTableLines: AssignedLine[];
}

export function buildTransactionRows(
  lines: AssignedLine[],
  schemas: ColumnSchema[],
): BuildTransactionRowsResult {
  const rows: LogicalRow[] = [];
  let currentRow: LogicalRow | null = null;
  let currentAnchorY = 0;
  let pendingContinuations: { line: AssignedLine; values: string[] }[] = [];
  const regionMeta = new Map<number, TableRegionMeta>();
  const postTableLines: AssignedLine[] = [];

  function flushToRow(row: LogicalRow | null): void {
    for (const { line: cl, values: cv } of pendingContinuations) {
      if (!row) continue;
      row.lines.push(cl);
      appendToRow(row, cv);
    }
    pendingContinuations = [];
  }

  /** Get or create per-region metadata, deriving x-bounds from schema */
  function getOrCreateMeta(regionIndex: number): TableRegionMeta | null {
    if (regionMeta.has(regionIndex)) return regionMeta.get(regionIndex)!;
    const schema = getSchemaForRegion(schemas, regionIndex);
    if (!schema) return null;
    const { startX, endX } = deriveXBounds(schema);
    const meta: TableRegionMeta = {
      regionIndex,
      pages: new Set(),
      started: false,
      ended: false,
      startY: null,
      endY: null,
      startX,
      endX,
    };
    regionMeta.set(regionIndex, meta);
    return meta;
  }

  for (const line of lines) {
    if (line.assignments.length === 0) continue;

    const meta = getOrCreateMeta(line.regionIndex);

    // Per-region ended check: skip lines from ended regions
    if (meta && meta.ended) {
      postTableLines.push(line);
      continue;
    }

    // Track which pages this region spans
    if (meta) meta.pages.add(line.line.page);

    const values = buildValues(line);
    const schema = getSchemaForRegion(schemas, line.regionIndex);
    const dateColIdx = schema?.dateColumnIndex ?? 0;

    // Noise/summary detection: exact keyword match OR structural (no date + ≥2 amounts)
    const noiseType = classifyNoiseRow(values);
    if (noiseType === 'opening') {
      // Opening noise rows (e.g., "Opening Balance") mark the start of the table.
      // Skip them without creating a row, but record that the table has begun.
      if (meta && !meta.started) meta.startY = line.line.y;
      if (meta) meta.started = true;
      continue;
    }
    if (noiseType === 'closing' || isSummaryRow(values, dateColIdx)) {
      // Closing noise/summary rows appear after the last transaction.
      // Flush pending continuations to preserve last-transaction description,
      // then end processing for this region to prevent post-table metadata from
      // corrupting rows. Other regions are unaffected.
      flushToRow(currentRow);
      if (meta) {
        meta.endY = line.line.y;
        meta.ended = true;
      }
      continue;
    }

    const hasDate = values[dateColIdx] && isDateLike(values[dateColIdx]);
    const isNewRegion = currentRow != null && currentRow.regionIndex !== line.regionIndex;

    if (hasDate || !currentRow || isNewRegion) {
      // Resolve pending continuations using midpoint boundary
      if (pendingContinuations.length > 0 && currentRow) {
        const prevAnchorY = currentAnchorY;
        const nextAnchorY = line.line.y;
        const midpoint = (prevAnchorY + nextAnchorY) / 2;

        const forPrevRow: typeof pendingContinuations = [];
        const forNextRow: typeof pendingContinuations = [];

        for (const cont of pendingContinuations) {
          if (cont.line.line.y > midpoint) {
            forPrevRow.push(cont);
          } else {
            forNextRow.push(cont);
          }
        }
        pendingContinuations = [];

        // Append prev-row continuations
        for (const { line: cl, values: cv } of forPrevRow) {
          currentRow.lines.push(cl);
          appendToRow(currentRow, cv);
        }

        // Create new row
        currentAnchorY = line.line.y;
        currentRow = { lines: [line], columnValues: values, regionIndex: line.regionIndex };
        rows.push(currentRow);
        if (meta && !meta.started) meta.startY = line.line.y;
        if (meta) meta.started = true;

        // Prepend next-row continuations in reverse to maintain top-to-bottom order
        // (forNextRow is FIFO = top-to-bottom; reverse so highest-y prepended last = first in output)
        for (let ri = forNextRow.length - 1; ri >= 0; ri--) {
          const { line: cl, values: cv } = forNextRow[ri];
          currentRow.lines.unshift(cl);
          prependToRow(currentRow, cv);
        }
      } else {
        pendingContinuations = [];
        currentAnchorY = line.line.y;
        currentRow = { lines: [line], columnValues: values, regionIndex: line.regionIndex };
        rows.push(currentRow);
        if (meta && !meta.started) meta.startY = line.line.y;
        if (meta) meta.started = true;
      }
    } else {
      // Continuation — buffer it
      pendingContinuations.push({ line, values });
    }
  }

  // Flush remaining continuations to last row (only when loop ended without region ended)
  flushToRow(currentRow);

  // For regions that never hit a closing marker, set endY to the last anchor's y
  for (const [, meta] of regionMeta) {
    if (meta.endY === null && meta.started) {
      meta.endY = currentAnchorY;
    }
  }

  return { rows, regionMeta, postTableLines };
}

const CLUSTER_TOLERANCE = 2.0;

function clusterYs(ys: number[], tolerance: number): number[] {
  if (ys.length === 0) return [];
  const sorted = [...ys].sort((a, b) => a - b);
  const clusters: number[] = [];
  let group = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] <= tolerance) {
      group.push(sorted[i]);
    } else {
      clusters.push(group.reduce((a, b) => a + b) / group.length);
      group = [sorted[i]];
    }
  }
  clusters.push(group.reduce((a, b) => a + b) / group.length);
  return clusters;
}

function isAnchorType(type: ColumnDef['type']): boolean {
  return type !== 'description';
}

export function splitMergedLines(
  assignedLines: AssignedLine[],
  schemas: ColumnSchema[],
): AssignedLine[] {
  const schemaByRegion = new Map<number, ColumnSchema>();
  for (const schema of schemas) {
    schemaByRegion.set(schema.sourceRegionIndex, schema);
  }

  // Collect anchor y-positions per region
  const anchorYsByRegion = new Map<number, number[]>();
  for (const line of assignedLines) {
    if (line.isHeader) continue;
    const schema = schemaByRegion.get(line.regionIndex);
    if (!schema) continue;
    if (!anchorYsByRegion.has(line.regionIndex)) {
      anchorYsByRegion.set(line.regionIndex, []);
    }
    const anchorYs = anchorYsByRegion.get(line.regionIndex)!;
    for (let i = 0; i < line.line.items.length; i++) {
      const colIdx = line.assignments[i];
      const colDef = schema.columns[colIdx];
      if (colDef && isAnchorType(colDef.type)) {
        anchorYs.push(line.line.items[i].y);
      }
    }
  }

  // Compute boundaries per region
  const boundariesByRegion = new Map<number, number[]>();
  for (const [regionIndex, anchorYs] of anchorYsByRegion) {
    if (anchorYs.length === 0) continue;
    const clustered = clusterYs(anchorYs, CLUSTER_TOLERANCE);
    if (clustered.length < 2) continue;
    clustered.sort((a, b) => b - a); // descending: higher y = higher on page = first
    const boundaries: number[] = [];
    for (let i = 0; i < clustered.length - 1; i++) {
      boundaries.push((clustered[i] + clustered[i + 1]) / 2);
    }
    boundariesByRegion.set(regionIndex, boundaries);
  }

  // Process each line
  const result: AssignedLine[] = [];
  for (const line of assignedLines) {
    const boundaries = boundariesByRegion.get(line.regionIndex);
    if (!boundaries || line.isHeader || line.assignments.length === 0) {
      result.push(line);
      continue;
    }

    const buckets = new Map<number, { items: typeof line.line.items; assignments: number[] }>();
    for (let i = 0; i < line.line.items.length; i++) {
      const item = line.line.items[i];
      let bucket = boundaries.length;
      for (let b = 0; b < boundaries.length; b++) {
        if (item.y > boundaries[b]) {
          bucket = b;
          break;
        }
      }
      if (!buckets.has(bucket)) {
        buckets.set(bucket, { items: [], assignments: [] });
      }
      const b = buckets.get(bucket)!;
      b.items.push(item);
      b.assignments.push(line.assignments[i]);
    }

    if (buckets.size <= 1) {
      result.push(line);
    } else {
      const sorted = [...buckets.entries()].sort(([a], [b]) => a - b);
      for (const [, { items, assignments }] of sorted) {
        const minY = Math.min(...items.map(it => it.y));
        result.push({
          line: { y: minY, items, page: line.line.page },
          assignments,
          isHeader: false,
          regionIndex: line.regionIndex,
        });
      }
    }
  }

  return result;
}
