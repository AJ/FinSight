import type { Line, TableRegion, ProseRegion } from './extractionTypes';
import { MIN_HEADER_CONCEPTS } from './extractionTypes';
import { countDistinctConcepts } from './headerSynonyms';
import { extractDateFromText, DATE_MONTH_SEP } from '../dateParser';
import { debugLog } from '@/lib/utils/debug';

// Known limitation: multi-page tables without repeated headers are not detected.
// findRegionEnd stops at page boundaries, so if a table continues on page 2
// without repeating its header row, those continuation rows are classified as
// prose and excluded from the table region.
// See https://github.com/AJ/FinSight/issues/2

const AMOUNT_PATTERN = /[\d,]+\.\d{2}/;

const MIN_ANCHOR_LINES = 2;
// 4, not 3: the issuer's international-transactions rows wrap to 5 physical
// lines (verified live 2026-08-18: anchors=13, amountShare=0.92, maxRun=4).
// Prose rejection still holds — scattered prose dates sit 5+ lines apart.
const MAX_RUN_BETWEEN_ANCHORS = 4;
const MIN_ANCHORS_WITH_AMOUNT = 0.5;

/** A line that holds a date: a complete date (extractDateFromText validates the
 * calendar and year), or a yearless day-month cell like "01-Jan". Number shapes
 * (decimals, rates, references) match neither predicate. */
export function isAnchorLine(line: Line): boolean {
  return line.items.some(
    item => extractDateFromText(item.text) !== null || DATE_MONTH_SEP.test(item.text),
  );
}

function holdsAmount(line: Line): boolean {
  return line.items.some(item => AMOUNT_PATTERN.test(item.text));
}

/**
 * A region's data lines are table-like when date-bearing lines recur at row
 * rhythm: at least MIN_ANCHOR_LINES anchors, no stretch of dateless lines
 * longer than MAX_RUN_BETWEEN_ANCHORS between consecutive anchors (wrapped
 * rows), and at least half the anchor lines also carry an amount (money-table
 * signal). Lines after the last anchor are excluded from the run limit —
 * post-table summary rows are Stage 6's responsibility.
 */
function isTableLikeData(lines: Line[], start: number, end: number): boolean {
  const stats = anchorStats(lines, start, end);
  if (stats.anchorCount < MIN_ANCHOR_LINES) return false;
  if (stats.maxRun > MAX_RUN_BETWEEN_ANCHORS) return false;
  return stats.amountShare >= MIN_ANCHORS_WITH_AMOUNT;
}

/** The three gate measurements, for the rejection debug log. */
function anchorStats(lines: Line[], start: number, end: number): {
  anchorCount: number;
  maxRun: number;
  amountShare: number;
} {
  const anchorIdx: number[] = [];
  for (let i = start; i < end; i++) {
    if (isAnchorLine(lines[i])) anchorIdx.push(i);
  }
  let maxRun = 0;
  for (let k = 1; k < anchorIdx.length; k++) {
    maxRun = Math.max(maxRun, anchorIdx[k] - anchorIdx[k - 1] - 1);
  }
  const withAmount = anchorIdx.filter(i => holdsAmount(lines[i]));
  const amountShare = anchorIdx.length > 0 ? withAmount.length / anchorIdx.length : 0;
  return { anchorCount: anchorIdx.length, maxRun, amountShare };
}

function isHeaderCandidate(line: Line): boolean {
  const texts = line.items.map(i => i.text);
  const { count } = countDistinctConcepts(texts);
  return count >= MIN_HEADER_CONCEPTS;
}

function findRegionEnd(lines: Line[], headerIndex: number): number {
  const headerPage = lines[headerIndex].page;

  for (let i = headerIndex + 1; i < lines.length; i++) {
    if (lines[i].page !== headerPage) return i;
    if (isHeaderCandidate(lines[i])) return i;

    if (i > headerIndex + 1) {
      const prevGap = Math.abs(lines[i - 1].y - lines[i - 2].y);
      const currentGap = Math.abs(lines[i].y - lines[i - 1].y);
      if (currentGap > prevGap * 3 && currentGap > 30) return i;
    }
  }
  return lines.length;
}

export function detectTableRegions(lines: Line[]): {
  tableRegions: TableRegion[];
  proseRegions: ProseRegion[];
} {
  const tableRegions: TableRegion[] = [];
  const proseRegions: ProseRegion[] = [];
  const tableLineIndices = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (!isHeaderCandidate(lines[i])) continue;

    const endLine = findRegionEnd(lines, i);
    const dataStart = i + 1;

    if (dataStart < endLine) {
      if (isTableLikeData(lines, dataStart, endLine)) {
        tableRegions.push({
          startLineIndex: i,
          endLineIndex: endLine,
          page: lines[i].page,
        });
        for (let j = i; j < endLine; j++) {
          tableLineIndices.add(j);
        }
      } else {
        const s = anchorStats(lines, dataStart, endLine);
        debugLog('table_detector', `Region rejected (header line ${i}, lines ${dataStart}-${endLine}): ` +
          `anchors=${s.anchorCount} (need ≥${MIN_ANCHOR_LINES}), maxRun=${s.maxRun} (allow ≤${MAX_RUN_BETWEEN_ANCHORS}), ` +
          `amountShare=${s.amountShare.toFixed(2)} (need ≥${MIN_ANCHORS_WITH_AMOUNT})`);
      }
    }
  }

  let proseStart: number | null = null;
  for (let i = 0; i <= lines.length; i++) {
    const inTable = i < lines.length && tableLineIndices.has(i);
    if (!inTable && proseStart === null && i < lines.length) {
      proseStart = i;
    } else if ((inTable || i === lines.length) && proseStart !== null) {
      proseRegions.push({
        startLineIndex: proseStart,
        endLineIndex: i,
        page: lines[proseStart].page,
      });
      proseStart = null;
    }
  }

  return { tableRegions, proseRegions };
}
