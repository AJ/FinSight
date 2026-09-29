export interface RawTextItem {
  text: string;
  x: number;        // left edge (from transform[4])
  right: number;    // right edge (x + width)
  y: number;        // vertical position (from transform[5])
  page: number;     // 1-indexed page number
  height: number;   // font height (|transform[3]|); 0 when the source omits it
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
  /** Runtime-derived snap allowance for containment assignment (stack detection). */
  snapTolerance?: number;
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

/** One detected column of a transaction table: its header text and the role
 * the geometry pipeline derived from the header concepts. */
export interface StatementTableColumnInfo {
  headerText: string;
  type: ColumnDef['type'];
}

/**
 * A transaction table located by the geometry path, with 0-based line indexes
 * into the text the geometry pipeline emitted (before normalization). The
 * pipeline translates these indexes through the line map returned by
 * normalizeStatementWithLineMap before using them for request-only headers.
 */
export interface StatementTableInfo {
  headerLineIndex: number;
  dataRowLineIndexes: number[];
  columns: StatementTableColumnInfo[];
}

/** Tolerance in pixels for grouping items into the same y-line. */
export const Y_GROUP_TOLERANCE = 3;

/** Minimum distinct header concepts required to identify a header row. */
export const MIN_HEADER_CONCEPTS = 3;
