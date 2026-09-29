import type { AssignedLine, LogicalRow, ColumnSchema, ColumnDef } from './extractionTypes';
import { isDateLike } from '../dateParser';

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

// Section headings that introduce the post-transaction summary block. When one
// appears, the transaction table is definitively over — everything above it is
// table-side, everything from it down is post-table. Unlike closing markers
// ("Closing balance") or numeric summary rows, a heading can sit well above the
// trailing totals row, so it must end the table before that distance can pull a
// bad midpoint down through the section. Exact standalone match only (same
// normalization as classifyNoiseRow), so "Summary Foods Restaurant" is safe.
const SECTION_HEADINGS = [
  'summary',
  'transaction summary',
  'statement summary',
  'account summary',
  'summary of transactions',
];

function isSectionHeading(values: string[]): boolean {
  const normalized = values.map(v =>
    v.toLowerCase().replace(/[:.\s]+$/g, '').trim(),
  );
  return normalized.some(v => SECTION_HEADINGS.includes(v));
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

function buildValues(line: AssignedLine, count: number): string[] {
  const values: string[] = [];
  const numCols = Math.max(count, Math.max(...line.assignments, 0) + 1);
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

/** Attach only nearby text aligned with a narrative cell, never arbitrary
 * dateless rows. Uncertain lines remain separate in the model input. */
function canAttachContinuation(row: LogicalRow, line: AssignedLine, schema: ColumnSchema | undefined): boolean {
  if (!schema || line.isHeader || row.regionIndex !== line.regionIndex
    || row.lines.some(l => l.isHeader || l.line.page !== line.line.page)) return false;
  const items = line.line.items.filter(item => item.text.trim());
  const heights = [...items, ...row.lines.flatMap(l => l.line.items)]
    .map(item => item.height).filter(height => height > 0).sort((a, b) => a - b);
  // Missing geometry is not evidence that two physical lines belong together.
  if (!items.length || !heights.length) return false;
  const height = heights[Math.floor(heights.length / 2)];
  const gap = Math.min(...row.lines.map(l => Math.abs(l.line.y - line.line.y)));
  // Allow normal/double-spaced wrapping, measured in the document's font size.
  if (gap > height * 2.5) return false;

  const occupied = new Set(line.assignments.filter((_, i) => line.line.items[i].text.trim()));
  return [...occupied].every(col => {
    const column = schema.columns[col];
    if (!column || (column.type !== 'description' && column.type !== 'reference')) return false;
    const starts = row.lines.flatMap(l => l.line.items
      .filter((other, j) => l.assignments[j] === col && other.text.trim())
      .map(other => other.x));
    // An above-anchor description may be the first text in this cell.
    const left = starts.length ? Math.min(...starts) : column.columnLeft;
    const lineLeft = Math.min(...line.line.items
      .filter((item, i) => line.assignments[i] === col && item.text.trim()).map(item => item.x));
    return Math.abs(lineLeft - left) <= (schema.snapTolerance ?? height);
  });
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

  // Uniform cell count per region: every row of a region renders the same
  // number of cells (schema columns plus the overflow slot when any line in
  // the region used it), so header and data rows stay cell-aligned.
  const regionColCount = new Map<number, number>();
  for (const line of lines) {
    if (line.assignments.length === 0) continue;
    const schema = getSchemaForRegion(schemas, line.regionIndex);
    const base = schema ? schema.columns.length : 0;
    const needed = Math.max(base, ...line.assignments.map(a => a + 1));
    regionColCount.set(line.regionIndex, Math.max(regionColCount.get(line.regionIndex) ?? base, needed));
  }

  function flushToRow(row: LogicalRow | null): void {
    let connected = true;
    for (const { line: cl, values: cv } of pendingContinuations) {
      if (connected && row && canAttachContinuation(row, cl, getSchemaForRegion(schemas, cl.regionIndex))) {
        row.lines.push(cl);
        appendToRow(row, cv);
      } else {
        connected = false;
        rows.push({ lines: [cl], columnValues: cv, regionIndex: cl.regionIndex });
      }
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

    const values = buildValues(line, regionColCount.get(line.regionIndex) ?? 0);
    const schema = getSchemaForRegion(schemas, line.regionIndex);
    const dateColIdx = schema?.dateColumnIndex ?? 0;

    // Page coordinates and column indexes are local to their region. Resolve
    // the old row before seeing a new header/layout, without a cross-page midpoint.
    // currentRow is loop-carried state; retain its declared type at this boundary.
    const previous: AssignedLine | undefined = (currentRow as LogicalRow | null)?.lines[0]
      ?? pendingContinuations[0]?.line;
    if (previous && (previous.regionIndex !== line.regionIndex
      || previous.line.page !== line.line.page)) {
      flushToRow(currentRow);
      currentRow = null;
    }
    if (line.isHeader) {
      flushToRow(currentRow);
      rows.push({ lines: [line], columnValues: values, regionIndex: line.regionIndex });
      currentRow = null;
      continue;
    }

    // Noise/summary detection: exact keyword match OR structural (no date + ≥2 amounts)
    const noiseType = classifyNoiseRow(values);
    if (noiseType === 'opening') {
      // Keep opening boundary rows in the table text so the transaction pass can
      // recover openingBalance when the summary section is absent or mangled.
      if (meta && !meta.started) meta.startY = line.line.y;
      if (meta) meta.started = true;
    }
    // Section heading = hard table end. A heading (e.g. "SUMMARY") introduces
    // the post-transaction block and can sit well above the trailing "Closing
    // balance" row. End the table here so the heading, its prose, and the
    // summary table route to postTableLines instead of being merged into the
    // last transaction by a midpoint computed against the distant totals row.
    // Resolve pending wrapping with the same alignment/proximity checks used
    // at other boundaries; being above a heading alone does not prove ownership.
    if (isSectionHeading(values)) {
      flushToRow(currentRow);
      if (meta) {
        meta.endY = line.line.y;
        meta.ended = true;
      }
      postTableLines.push(line);
      continue;
    }

    if (noiseType === 'closing' || isSummaryRow(values, dateColIdx)) {
      // Closing/summary rows appear after the last transaction. Preserve them as
      // post-table prose, but do not let them become continuations of the last row.
      // The midpoint limits candidates; alignment and proximity must still agree.
      if (pendingContinuations.length > 0) {
        if (currentRow) {
          const midpoint = (currentAnchorY + line.line.y) / 2;
          for (const cont of pendingContinuations) {
            if (cont.line.line.y > midpoint && canAttachContinuation(currentRow, cont.line, schema)) {
              currentRow.lines.push(cont.line);
              appendToRow(currentRow, cont.values);
            } else {
              postTableLines.push(cont.line);
            }
          }
        } else {
          flushToRow(null);
        }
        pendingContinuations = [];
      }
      if (meta) {
        meta.endY = line.line.y;
        meta.ended = true;
      }
      postTableLines.push(line);
      continue;
    }

    const hasDate = values[dateColIdx] && isDateLike(values[dateColIdx]);

    if (!hasDate && !currentRow) {
      pendingContinuations.push({ line, values });
      continue;
    }
    if (hasDate && meta) meta.endY = line.line.y;

    if (hasDate) {
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
          if (canAttachContinuation(currentRow, cl, schema)) {
            currentRow.lines.push(cl);
            appendToRow(currentRow, cv);
          } else {
            rows.push({ lines: [cl], columnValues: cv, regionIndex: cl.regionIndex });
          }
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
          if (canAttachContinuation(currentRow, cl, schema)) {
            currentRow.lines.unshift(cl);
            prependToRow(currentRow, cv);
          } else {
            rows.push({ lines: [cl], columnValues: cv, regionIndex: cl.regionIndex });
          }
        }
      } else {
        currentAnchorY = line.line.y;
        currentRow = { lines: [line], columnValues: values, regionIndex: line.regionIndex };
        rows.push(currentRow);
        // The first transaction can have its description above its date/amount.
        // A header is never used as the preceding anchor for these lines.
        for (const cont of [...pendingContinuations].reverse()) {
          if (canAttachContinuation(currentRow, cont.line, schema)) {
            currentRow.lines.unshift(cont.line);
            prependToRow(currentRow, cont.values);
          } else {
            rows.push({ lines: [cont.line], columnValues: cont.values, regionIndex: cont.line.regionIndex });
          }
        }
        pendingContinuations = [];
        if (meta && !meta.started) meta.startY = line.line.y;
        if (meta) meta.started = true;
      }
    } else {
      // Continuation — buffer it
      pendingContinuations.push({ line, values });
    }
  }

  // Keep nearby aligned wrapping; preserve the rest as independent physical rows.
  flushToRow(currentRow);

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
