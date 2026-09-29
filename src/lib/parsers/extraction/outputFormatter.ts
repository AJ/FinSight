import type { LogicalRow, ProseRegion, Line, ColumnSchema, AssignedLine } from './extractionTypes';

interface FormatInput {
  rows: LogicalRow[];
  proseRegions: ProseRegion[];
  allLines: Line[];
  schemas: ColumnSchema[];
  postTableLines?: AssignedLine[];
}

/** A table row's position in the emitted text (row-identity spec §3). */
export interface RowSegment {
  regionIndex: number;
  /** 0-based line index of this row within the emitted text. */
  lineIndex: number;
  isHeader: boolean;
}

export interface FormatOutputResult {
  text: string;
  rowSegments: RowSegment[];
}

function formatProseLines(lines: Line[]): string {
  return lines.map(line => line.items.map(i => i.text).join(' ')).join('\n');
}

function schemasDiffer(a: ColumnSchema | undefined, b: ColumnSchema | undefined): boolean {
  if (!a || !b) return true;
  if (a.columns.length !== b.columns.length) return true;
  return a.columns.some((col, i) => col.headerText !== b.columns[i].headerText);
}

export function formatOutputWithSegments(input: FormatInput): FormatOutputResult {
  const { rows, proseRegions, allLines, schemas, postTableLines } = input;
  if (rows.length === 0 && proseRegions.length === 0 && (!postTableLines || postTableLines.length === 0)) {
    return { text: '', rowSegments: [] };
  }

  const parts: string[] = [];
  const rowSegments: RowSegment[] = [];
  // Lines emitted so far. Parts are joined with '\n', so the total line count of
  // the final text is the sum of each part's line count.
  let lineIndex = 0;
  let lastPage = 0;
  let lastRegionIndex = -1;

  const allPages = new Set<number>();
  for (const row of rows) allPages.add(row.lines[0]?.line.page ?? 1);
  for (const pr of proseRegions) allPages.add(pr.page);
  if (postTableLines) for (const ptl of postTableLines) allPages.add(ptl.line.page);
  const sortedPages = [...allPages].sort((a, b) => a - b);

  for (const page of sortedPages) {
    if (page !== lastPage && lastPage > 0) {
      parts.push('\n--- PAGE BREAK ---\n');
      lineIndex += 3; // the page-break part spans three lines ('', marker, '')
    }
    lastPage = page;
    lastRegionIndex = -1;

    const pageProse = proseRegions.filter(pr => pr.page === page);
    const pageRows = rows.filter(r => r.lines[0]?.line.page === page);

    type Segment = { y: number; text: string; regionIndex: number; isHeader: boolean };
    const segments: Segment[] = [];

    for (const pr of pageProse) {
      const proseLines = allLines.slice(pr.startLineIndex, pr.endLineIndex);
      if (proseLines.length > 0) {
        segments.push({
          y: proseLines[0].y,
          text: formatProseLines(proseLines),
          regionIndex: -1,
          isHeader: false,
        });
      }
    }

    for (const row of pageRows) {
      const prevSchema = lastRegionIndex >= 0 ? schemas.find(s => s.sourceRegionIndex === lastRegionIndex) : undefined;
      const currentSchema = schemas.find(s => s.sourceRegionIndex === row.regionIndex);
      const line = row.columnValues.join('||');

      let prefix = '';
      if (lastRegionIndex >= 0 && lastRegionIndex !== row.regionIndex && schemasDiffer(prevSchema, currentSchema)) {
        prefix = '\n';
      }

      segments.push({
        y: row.lines[0]?.line.y ?? 0,
        text: prefix + line,
        regionIndex: row.regionIndex,
        isHeader: row.lines.some(l => l.isHeader),
      });
      lastRegionIndex = row.regionIndex;
    }

    // Post-table lines (after closing/summary row) rendered as prose
    if (postTableLines) {
      const pagePostTable = postTableLines.filter(ptl => ptl.line.page === page);
      for (const ptl of pagePostTable) {
        const text = ptl.line.items.map(i => i.text).join(' ');
        if (text.trim()) {
          segments.push({
            y: ptl.line.y,
            text,
            regionIndex: -1,
            isHeader: false,
          });
        }
      }
    }

    segments.sort((a, b) => b.y - a.y);
    for (const seg of segments) {
      parts.push(seg.text);
      const partLineCount = seg.text.split('\n').length;
      if (seg.regionIndex >= 0) {
        rowSegments.push({
          regionIndex: seg.regionIndex,
          // A part with a '\n' prefix puts the row on its LAST line.
          lineIndex: lineIndex + partLineCount - 1,
          isHeader: seg.isHeader,
        });
      }
      lineIndex += partLineCount;
    }
  }

  return { text: parts.join('\n'), rowSegments };
}

/** Backwards-compatible string-only output (specs and any string consumers). */
export function formatOutput(input: FormatInput): string {
  return formatOutputWithSegments(input).text;
}
