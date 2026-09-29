import type { Line, TableRegion, ColumnSchema, ColumnDef } from './extractionTypes';
import { detectColumnStacks } from './stackDetector';
import { isAnchorLine } from './tableDetector';
import { debugLog } from '@/lib/utils/debug';

export function buildColumnSchemas(
  lines: Line[],
  regions: TableRegion[],
): ColumnSchema[] {
  const schemas: ColumnSchema[] = [];

  for (let ri = 0; ri < regions.length; ri++) {
    const region = regions[ri];
    const headerLine = lines[region.startLineIndex];

    // No header line: inherit the previous region's schema (unchanged rule).
    if (!headerLine || !headerLine.items.length) {
      if (schemas.length > 0) {
        schemas.push({ ...schemas[schemas.length - 1], sourceRegionIndex: ri });
      }
      continue;
    }

    const anchorRows: Line[] = [];
    for (let i = region.startLineIndex + 1; i < region.endLineIndex; i++) {
      if (lines[i] && isAnchorLine(lines[i])) anchorRows.push(lines[i]);
    }
    const detection = detectColumnStacks(headerLine, anchorRows);
    // Loud detection failure (spec Part 1): two headers in one stack group
    // means data items bridge a named-column gap — never silently patched.
    if (detection.twoHeaderCollision) {
      debugLog('schema_builder', `Region ${ri}: two header items in one stack group — data bridges a named-column gap`);
    }

    // Repeated headers identify roles, not physical coordinates. Keep this
    // region's detected bounds and tolerance; logical column alignment happens
    // later, after items have been assigned using their own table's geometry.
    const columns: ColumnDef[] = detection.stacks.map((st, i) => ({
      index: i,
      headerText: st.headerText ?? '',
      columnLeft: st.left,
      columnRight: st.right,
      type: (st.concept ?? 'unknown') as ColumnDef['type'],
    }));
    // The date column is the leftmost date-typed column (first-match rule).
    const dateIdx = columns.findIndex(c => c.type === 'date');
    schemas.push({
      columns,
      dateColumnIndex: dateIdx >= 0 ? dateIdx : 0,
      sourceRegionIndex: ri,
      snapTolerance: detection.tolerance,
    });
  }

  return schemas;
}
