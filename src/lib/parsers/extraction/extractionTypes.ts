export interface RawTextItem {
  text: string;
  x: number;        // left edge (from transform[4])
  right: number;    // right edge (x + width)
  y: number;        // vertical position (from transform[5])
  page: number;     // 1-indexed page number
}

export interface Line {
  y: number;
  items: RawTextItem[];
  page: number;
}

export interface TableRegion {
  startLineIndex: number;
  endLineIndex: number;
  page: number;
}

export interface ProseRegion {
  startLineIndex: number;
  endLineIndex: number;
  page: number;
}

export interface ColumnSchema {
  columns: ColumnDef[];
  dateColumnIndex: number;
  sourceRegionIndex: number;
}

export interface ColumnDef {
  index: number;
  headerText: string;
  columnLeft: number;
  columnRight: number;
  type: 'date' | 'description' | 'debit' | 'credit' | 'amount' | 'balance' | 'reference' | 'unknown';
}

export interface AssignedLine {
  line: Line;
  assignments: number[];
  isHeader: boolean;
  regionIndex: number;
}

export interface LogicalRow {
  lines: AssignedLine[];
  columnValues: string[];
  regionIndex: number;
}

/** Buffer in pixels added to each side of column cell boundaries. */
export const COLUMN_BUFFER_PX = 3;

/** Tolerance in pixels for grouping items into the same y-line. */
export const Y_GROUP_TOLERANCE = 3;

/** Minimum distinct header concepts required to identify a header row. */
export const MIN_HEADER_CONCEPTS = 3;
