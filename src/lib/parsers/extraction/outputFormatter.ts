import type { LogicalRow, ProseRegion, Line, ColumnSchema, AssignedLine } from './extractionTypes';

interface FormatInput {
  rows: LogicalRow[];
  proseRegions: ProseRegion[];
  allLines: Line[];
  schemas: ColumnSchema[];
  postTableLines?: AssignedLine[];
}

function formatProseLines(lines: Line[]): string {
  return lines.map(line => line.items.map(i => i.text).join(' ')).join('\n');
}

function schemasDiffer(a: ColumnSchema | undefined, b: ColumnSchema | undefined): boolean {
  if (!a || !b) return true;
  if (a.columns.length !== b.columns.length) return true;
  return a.columns.some((col, i) => col.headerText !== b.columns[i].headerText);
}

export function formatOutput(input: FormatInput): string {
  const { rows, proseRegions, allLines, schemas, postTableLines } = input;
  if (rows.length === 0 && proseRegions.length === 0 && (!postTableLines || postTableLines.length === 0)) return '';

  const parts: string[] = [];
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
    }
    lastPage = page;
    lastRegionIndex = -1;

    const pageProse = proseRegions.filter(pr => pr.page === page);
    const pageRows = rows.filter(r => r.lines[0]?.line.page === page);

    type Segment = { y: number; text: string; regionIndex: number };
    const segments: Segment[] = [];

    for (const pr of pageProse) {
      const proseLines = allLines.slice(pr.startLineIndex, pr.endLineIndex);
      if (proseLines.length > 0) {
        segments.push({
          y: proseLines[0].y,
          text: formatProseLines(proseLines),
          regionIndex: -1,
        });
      }
    }

    for (const row of pageRows) {
      const line = row.columnValues.join('||');
      const prevSchema = lastRegionIndex >= 0 ? schemas.find(s => s.sourceRegionIndex === lastRegionIndex) : undefined;
      const currentSchema = schemas.find(s => s.sourceRegionIndex === row.regionIndex);

      let prefix = '';
      if (lastRegionIndex >= 0 && lastRegionIndex !== row.regionIndex && schemasDiffer(prevSchema, currentSchema)) {
        prefix = '\n';
      }

      segments.push({
        y: row.lines[0]?.line.y ?? 0,
        text: prefix + line,
        regionIndex: row.regionIndex,
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
          });
        }
      }
    }

    segments.sort((a, b) => b.y - a.y);
    for (const seg of segments) {
      parts.push(seg.text);
    }
  }

  return parts.join('\n');
}
