import type { RawTextItem, Line } from './extractionTypes';
import { extractTextItems } from './extractTextItems';
import { groupIntoLines } from './lineGrouper';
import { detectTableRegions } from './tableDetector';
import { buildColumnSchemas } from './schemaBuilder';
import { assignColumns } from './columnAssigner';
import { buildTransactionRows, splitMergedLines } from './rowBuilder';
import { formatOutput } from './outputFormatter';
import { debugLog } from '@/lib/utils/debug';
import { countDistinctConcepts } from './headerSynonyms';

export { PDFPasswordError, PASSWORD_REASON, isPasswordError } from './extractTextItems';

const STAGE = 'pdf_extraction_pipeline';

/**
 * PDF extraction pipeline.
 * Drop-in replacement for the previous extractTextFromPDF.
 */
export async function extractTextFromPDF(
  file: File,
  password?: string,
): Promise<string> {
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

  if (lines.length === 0) return '';

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
  debugLog(STAGE, 'Stage 5: Data line details:', dataLineDetails);

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

  // Stage 7: LogicalRow[] + ProseRegion[] + Line[] → string
  const result = formatOutput({
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

  return result;
}
