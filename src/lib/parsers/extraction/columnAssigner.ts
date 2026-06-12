import type { Line, TableRegion, ColumnSchema, ColumnDef, AssignedLine } from './extractionTypes';
import { COLUMN_BUFFER_PX } from './extractionTypes';

interface ColumnStats {
  leftEdges: number[];
  rightEdges: number[];
  widths: number[];
}

function computeAllColumnGeometry(
  columns: ColumnDef[],
  stats: ColumnStats[],
  buffer: number,
): ColumnDef[] {
  const rawBounds = stats.map(s => {
    if (s.leftEdges.length === 0) return null;
    return {
      left: Math.min(...s.leftEdges),
      right: Math.max(...s.rightEdges),
    };
  });

  return columns.map((col, i) => {
    const bounds = rawBounds[i];
    if (!bounds) return col;

    let columnLeft: number;
    let columnRight: number;

    if (i === 0) {
      columnLeft = bounds.left - buffer;
    } else {
      const prev = rawBounds[i - 1];
      columnLeft = prev ? (prev.right + bounds.left) / 2 : bounds.left - buffer;
    }

    if (i === columns.length - 1) {
      columnRight = bounds.right + buffer;
    } else {
      const next = rawBounds[i + 1];
      columnRight = next ? (bounds.right + next.left) / 2 : bounds.right + buffer;
    }

    return { ...col, columnLeft, columnRight };
  });
}

/**
 * Pass 1 assignment: score each item against each header by proximity.
 * Considers both left-edge and right-edge distance. Right-aligned items
 * match their column via right-edge proximity; left-aligned items match
 * via left-edge proximity. This works without knowing alignment upfront.
 */
function assignByProximity(
  item: { x: number; right: number },
  headerItems: { x: number; right: number }[],
): number {
  let bestCol = 0;
  let bestScore = -1;

  for (let i = 0; i < headerItems.length; i++) {
    const leftDist = Math.abs(item.x - headerItems[i].x);
    const rightDist = Math.abs(item.right - headerItems[i].right);
    // Use inverse distance; 1/(1+dist) so exact match = 1.0
    const score = Math.max(1 / (1 + leftDist), 1 / (1 + rightDist));
    if (score > bestScore) {
      bestScore = score;
      bestCol = i;
    }
  }

  return bestCol;
}

/** Pass 2 assignment: use computed cell geometry. */
function assignByGeometry(item: { x: number }, columns: ColumnDef[]): number {
  for (let i = columns.length - 1; i >= 0; i--) {
    if (item.x >= columns[i].columnLeft) {
      return i;
    }
  }
  return 0;
}

export function assignColumns(
  lines: Line[],
  regions: TableRegion[],
  schemas: ColumnSchema[],
): AssignedLine[] {
  const result: AssignedLine[] = [];

  for (let ri = 0; ri < regions.length; ri++) {
    const region = regions[ri];
    const schema = schemas[ri];
    if (!schema) continue;

    // startLineIndex always points to the header row (set by tableDetector).
    // The proximity scorer uses header items as anchor points. If schema
    // inheritance without headers is added later, this assumption must change —
    // the scorer would need the original header items, not a data row.
    const headerLineIdx = region.startLineIndex;
    const headerLine = lines[headerLineIdx];
    if (!headerLine) continue;

    // ---- Pass 1: proximity-based assignment ----
    const stats: ColumnStats[] = schema.columns.map(() => ({
      leftEdges: [] as number[],
      rightEdges: [] as number[],
      widths: [] as number[],
    }));

    for (let i = headerLineIdx; i < region.endLineIndex; i++) {
      const line = lines[i];
      if (!line) continue;
      for (const item of line.items) {
        const colIdx = assignByProximity(item, headerLine.items);
        stats[colIdx].leftEdges.push(item.x);
        stats[colIdx].rightEdges.push(item.right);
        stats[colIdx].widths.push(item.right - item.x);
      }
    }

    const pass1Columns = computeAllColumnGeometry(schema.columns, stats, COLUMN_BUFFER_PX);

    // ---- Pass 2: geometry-based re-assignment ----
    const stats2: ColumnStats[] = pass1Columns.map(() => ({
      leftEdges: [] as number[],
      rightEdges: [] as number[],
      widths: [] as number[],
    }));

    for (let i = headerLineIdx; i < region.endLineIndex; i++) {
      const line = lines[i];
      if (!line) continue;
      for (const item of line.items) {
        const colIdx = assignByGeometry(item, pass1Columns);
        stats2[colIdx].leftEdges.push(item.x);
        stats2[colIdx].rightEdges.push(item.right);
        stats2[colIdx].widths.push(item.right - item.x);
      }
    }

    const finalColumns = computeAllColumnGeometry(schema.columns, stats2, COLUMN_BUFFER_PX);

    // Build assigned lines
    for (let i = region.startLineIndex; i < region.endLineIndex; i++) {
      const line = lines[i];
      if (!line) continue;
      const isHeader = i === headerLineIdx;
      const assignments = line.items.map(item => assignByGeometry(item, finalColumns));
      result.push({ line, assignments, isHeader, regionIndex: ri });
    }
  }

  return result;
}
