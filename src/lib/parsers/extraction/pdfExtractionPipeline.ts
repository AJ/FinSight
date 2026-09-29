import type { RawTextItem, Line, StatementTableInfo } from './extractionTypes';
import { extractTextItems } from './extractTextItems';
import { groupIntoLines } from './lineGrouper';
import { detectTableRegions, isAnchorLine } from './tableDetector';
import { buildColumnSchemas } from './schemaBuilder';
import { assignColumns } from './columnAssigner';
import { buildTransactionRows, splitMergedLines } from './rowBuilder';
import { formatOutputWithSegments } from './outputFormatter';
import { debugLog } from '@/lib/utils/debug';
import { countDistinctConcepts } from './headerSynonyms';
import { groupOverlapping, deriveMergeTolerance } from './stackDetector';
import { extractDateFromText } from '../dateParser';

export { PDFPasswordError, PASSWORD_REASON, isPasswordError } from './extractTextItems';

const STAGE = 'pdf_extraction_pipeline';

/**
 * PDF extraction pipeline.
 * Drop-in replacement for the previous extractTextFromPDF, now also returning
 * the located transaction tables (row-identity spec §3) so the transactions
 * pass can inject headers into later chunks deterministically.
 */
export async function extractTextFromPDF(
  file: File,
  password?: string,
): Promise<{ text: string; tables: StatementTableInfo[] }> {
  // Stage 1: PDF → RawTextItem[]
  const items: RawTextItem[] = await extractTextItems(file, password);
  debugLog(STAGE, `Stage 1 (extractTextItems): ${items.length} text items extracted`);

  // Stage 2: RawTextItem[] → Line[]
  const lines: Line[] = groupIntoLines(items);
  debugLog(STAGE, `Stage 2 (groupIntoLines): ${lines.length} lines grouped`);
  if (lines.length > 0) {
    const sampleLines = lines.slice(0, 10).map((l, i) => ({
      line: i,
      page: l.page,
      y: l.y.toFixed(1),
      texts: l.items.map(it => it.text),
    }));
    debugLog(STAGE, 'Stage 2: First 10 lines:', sampleLines);

    // Log lines where items span >2px y-range (potential row merges)
    const mergeCandidates = lines
      .map((l, i) => {
        if (l.items.length < 2) return null;
        const ys = l.items.map(it => it.y);
        const spread = Math.max(...ys) - Math.min(...ys);
        if (spread <= 2) return null;
        return {
          lineIndex: i,
          page: l.page,
          lineY: l.y.toFixed(1),
          ySpread: spread.toFixed(1),
          items: l.items.map(it => ({ text: it.text, y: it.y.toFixed(1), x: it.x.toFixed(1) })),
        };
      })
      .filter(Boolean);
    debugLog(STAGE, `Stage 2: Lines with y-spread > 2px (${mergeCandidates.length} candidates):`, mergeCandidates);
  }

  if (lines.length === 0) return { text: '', tables: [] };

  // Stage 3: Line[] → TableRegion[] + ProseRegion[]
  const { tableRegions, proseRegions } = detectTableRegions(lines);

  // Log header candidate analysis for every line
  const headerAnalysis = lines.map((l, i) => {
    const texts = l.items.map(it => it.text);
    const { count, concepts } = countDistinctConcepts(texts);
    if (count > 0) {
      return {
        lineIndex: i,
        page: l.page,
        texts,
        conceptCount: count,
        concepts: Object.fromEntries(concepts),
      };
    }
    return null;
  }).filter(Boolean);

  debugLog(STAGE, `Stage 3 (detectTableRegions): ${tableRegions.length} table regions, ${proseRegions.length} prose regions`);
  debugLog(STAGE, `Stage 3: Lines with header concepts (need >= 3 for header candidate):`, headerAnalysis);

  // Stage 4: Line[] + TableRegion[] → ColumnSchema[]
  const schemas = buildColumnSchemas(lines, tableRegions);
  debugLog(STAGE, `Stage 4 (buildColumnSchemas): ${schemas.length} schemas built`, schemas.map(s => ({
    columns: s.columns.map(c => c.headerText),
    dateColumnIndex: s.dateColumnIndex,
    regionIndex: s.sourceRegionIndex,
  })));

  // Stage 5: Line[] + TableRegion[] + ColumnSchema[] → AssignedLine[]
  const assignedLines = assignColumns(lines, tableRegions, schemas);
  const headerAssignments = assignedLines.filter(l => l.isHeader).map(l => ({
    texts: l.line.items.map(i => i.text),
    assignments: l.assignments,
    xPositions: l.line.items.map(i => i.x),
  }));
  debugLog(STAGE, `Stage 5 (assignColumns): ${assignedLines.length} lines assigned`);
  if (headerAssignments.length > 0) {
    debugLog(STAGE, 'Stage 5: Header assignments:', headerAssignments);
    debugLog(STAGE, 'Stage 5: Schema column bounds:', schemas.map(s => s.columns.map(c => ({
      header: c.headerText,
      left: c.columnLeft.toFixed(1),
      right: c.columnRight.toFixed(1),
    }))));
  }

  // Stack measurement (spec Part 0, gate for the detection work): overlap-only
  // groups with row coverage, the same-row gap scales the tolerance is checked
  // against, font heights (header row included this time), and the row rhythm.
  // Numbers only — never item text.
  for (let ri = 0; ri < tableRegions.length; ri++) {
    const region = tableRegions[ri];
    const headerLine = lines[region.startLineIndex];
    if (!headerLine) continue;
    const detectionLines: Line[] = [headerLine];
    for (let i = region.startLineIndex + 1; i < region.endLineIndex; i++) {
      if (lines[i] && isAnchorLine(lines[i])) detectionLines.push(lines[i]);
    }
    if (detectionLines.length < 3) continue; // need the header plus >= 2 date rows

    const gaps: number[] = [];
    for (const line of detectionLines) {
      const sorted = [...line.items].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i++) {
        gaps.push(Math.round(sorted[i].x - sorted[i - 1].right));
      }
    }
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const gapSummary = sortedGaps.length > 0
      ? `min${sortedGaps[0]}/med${sortedGaps[Math.floor(sortedGaps.length / 2)]}/max${sortedGaps[sortedGaps.length - 1]}`
      : 'none';
    const tolerance = deriveMergeTolerance(detectionLines.slice(1).flatMap(l => l.items.map(it => it.height)));

    const previewItems = detectionLines.flatMap((line, li) =>
      line.items.map(it => ({ x: it.x, right: it.right, row: li })));
    const preview = groupOverlapping(previewItems, 0).map(g => {
      const left = Math.round(Math.min(...g.map(i => i.x)));
      const right = Math.round(Math.max(...g.map(i => i.right)));
      const rows = new Set(g.map(i => i.row)).size;
      return `[L${left}-${right} c${rows}]`;
    });

    const headerHeights = headerLine.items.map(it => it.height);
    const bodyHeights = [...new Set(detectionLines.slice(1).flatMap(l => l.items.map(it => it.height)))].sort((a, b) => a - b);
    const datelessHeights = assignedLines
      .filter(l => l.regionIndex === ri && !l.isHeader && !l.line.items.some(it => extractDateFromText(it.text) !== null || /[\d,]+\.\d{2}/.test(it.text)))
      .map(l => l.line.items.map(it => it.height));

    const datedYs = assignedLines
      .filter(l => l.regionIndex === ri && !l.isHeader && l.line.items.some(it => extractDateFromText(it.text) !== null))
      .map(l => l.line.y).sort((a, b) => b - a);
    const rowGaps: number[] = [];
    for (let i = 1; i < datedYs.length; i++) rowGaps.push(Math.round(datedYs[i - 1] - datedYs[i]));

    debugLog(STAGE, `STACKS region=${ri} detectionRows=${detectionLines.length} tolerance=${tolerance} sameRowGaps=${gapSummary} groups=${preview.join(' ')} headerHeights=${JSON.stringify(headerHeights)} bodyHeights=${JSON.stringify(bodyHeights)} datelessHeights=${JSON.stringify(datelessHeights.slice(0, 12))} rowGaps=${JSON.stringify(rowGaps.slice(0, 40))}`);
  }

  // Log all data lines with per-item (text, y, x, columnIndex) for merge diagnosis
  const dataLineDetails = assignedLines.filter(l => !l.isHeader).map((l, i) => ({
    lineIndex: i,
    page: l.line.page,
    lineY: l.line.y.toFixed(1),
    region: l.regionIndex,
    items: l.line.items.map((it, j) => ({
      text: it.text,
      y: it.y.toFixed(1),
      x: it.x.toFixed(1),
      col: l.assignments[j],
    })),
  }));
  for (const detail of dataLineDetails) {
    debugLog(STAGE, `Stage 5: Data line ${detail.lineIndex}: ${JSON.stringify(detail)}`);
  }

  // Stage 5.5: Split incorrectly merged lines
  const correctedLines = splitMergedLines(assignedLines, schemas);
  debugLog(STAGE, `Stage 5.5 (splitMergedLines): ${assignedLines.length} → ${correctedLines.length} lines`);

  // Stage 6: AssignedLine[] + ColumnSchema[] → LogicalRow[]
  const { rows, regionMeta, postTableLines } = buildTransactionRows(correctedLines, schemas);
  const headerRowCount = rows.filter(r => r.lines.some(l => l.isHeader)).length;
  const dataRowCount = rows.length - headerRowCount;
  const regionBounds = [...regionMeta.values()].map(m =>
    `region${m.regionIndex}: y=${m.startY}–${m.endY}, x=${m.startX}–${m.endX}, pages=[${[...m.pages].join(',')}]`
  ).join('; ');
  debugLog(STAGE, `Stage 6 (buildTransactionRows): ${rows.length} rows built (${dataRowCount} data + ${headerRowCount} header), regions: ${regionBounds || 'none'}`);

  // Stage 7: LogicalRow[] + ProseRegion[] + Line[] → string + table positions
  const { text: result, rowSegments } = formatOutputWithSegments({
    rows,
    proseRegions,
    allLines: lines,
    schemas,
    postTableLines,
  });
  const hasSeparators = result.includes('||');
  debugLog(STAGE, `Stage 7 (formatOutput): ${result.length} chars, contains || separators: ${hasSeparators}`);
  if (!hasSeparators && rows.length === 0 && lines.length > 5) {
    debugLog(STAGE, 'WARNING: No || separators in output — table detection failed, all text is prose');
  }

  // Group row segments into tables (one per geometry region). A table needs a
  // header line and at least one data row to be worth injecting anywhere.
  const byRegion = new Map<number, { headerLineIndex: number; dataRowLineIndexes: number[] }>();
  for (const seg of rowSegments) {
    const entry = byRegion.get(seg.regionIndex) ?? { headerLineIndex: -1, dataRowLineIndexes: [] };
    if (seg.isHeader) entry.headerLineIndex = seg.lineIndex;
    else entry.dataRowLineIndexes.push(seg.lineIndex);
    byRegion.set(seg.regionIndex, entry);
  }
  const tables: StatementTableInfo[] = [...byRegion.entries()]
    .filter(([, t]) => t.headerLineIndex >= 0 && t.dataRowLineIndexes.length > 0)
    .map(([regionIndex, t]) => ({
      ...t,
      // Column roles come from the region's schema (schemas[ri] is built for
      // region ri — see buildColumnSchemas).
      columns: (schemas[regionIndex]?.columns ?? []).map(c => ({
        headerText: c.headerText,
        type: c.type,
      })),
    }));

  return { text: result, tables };
}
