import type { Line, TableRegion, ColumnSchema, ColumnDef, AssignedLine } from './extractionTypes';

/**
 * Containment assignment (spec Part 2): an item belongs to the column whose
 * x-range contains it — largest overlap wins for straddling items, a snap
 * allowance (the runtime-derived tolerance carried on the schema) rescues
 * near-misses, and items matching no column go to the overflow slot
 * (index = columns.length), which renders as the row's trailing cell.
 */
function assignItem(
  item: { x: number; right: number },
  columns: ColumnDef[],
  snap: number,
): number {
  let best = -1;
  let bestOverlap = 0;
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    const overlap = Math.min(item.right, c.columnRight) - Math.max(item.x, c.columnLeft);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = i;
    }
  }
  if (best >= 0) return best;

  // No overlap with any column: snap to the nearest edge within tolerance.
  let snapBest = -1;
  let snapDist = Infinity;
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    const dist = item.right < c.columnLeft
      ? c.columnLeft - item.right
      : item.x > c.columnRight
        ? item.x - c.columnRight
        : 0;
    if (dist <= snap && dist < snapDist) {
      snapDist = dist;
      snapBest = i;
    }
  }
  return snapBest >= 0 ? snapBest : columns.length;
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
    const snap = schema.snapTolerance ?? 0;
    for (let i = region.startLineIndex; i < region.endLineIndex; i++) {
      const line = lines[i];
      if (!line) continue;
      const assignments = line.items.map(it => assignItem(it, schema.columns, snap));
      result.push({ line, assignments, isHeader: i === region.startLineIndex, regionIndex: ri });
    }
  }
  return result;
}
