import type { Line, TableRegion, ProseRegion } from './extractionTypes';
import { MIN_HEADER_CONCEPTS } from './extractionTypes';
import { countDistinctConcepts } from './headerSynonyms';
import { isDateLike } from '../datePatterns';

// Known limitation: multi-page tables without repeated headers are not detected.
// findRegionEnd stops at page boundaries, so if a table continues on page 2
// without repeating its header row, those continuation rows are classified as
// prose and excluded from the table region.
// See https://github.com/AJ/FinSight/issues/2

const AMOUNT_PATTERN = /[\d,]+\.\d{2}/;

function isHeaderCandidate(line: Line): boolean {
  const texts = line.items.map(i => i.text);
  const { count } = countDistinctConcepts(texts);
  return count >= MIN_HEADER_CONCEPTS;
}

function hasDateLikeValues(lines: Line[], start: number, end: number): boolean {
  let dateCount = 0;
  let total = 0;
  for (let i = start; i < end; i++) {
    total++;
    if (lines[i].items.some(item => isDateLike(item.text))) {
      dateCount++;
    }
  }
  return total > 0 && dateCount >= total * 0.5;
}

function hasAmountLikeValues(lines: Line[], start: number, end: number): boolean {
  let amountCount = 0;
  let total = 0;
  for (let i = start; i < end; i++) {
    total++;
    if (lines[i].items.some(item => AMOUNT_PATTERN.test(item.text))) {
      amountCount++;
    }
  }
  return total > 0 && amountCount >= total * 0.5;
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
      const hasDates = hasDateLikeValues(lines, dataStart, endLine);
      const hasAmounts = hasAmountLikeValues(lines, dataStart, endLine);

      if (hasDates || hasAmounts) {
        tableRegions.push({
          startLineIndex: i,
          endLineIndex: endLine,
          page: lines[i].page,
        });
        for (let j = i; j < endLine; j++) {
          tableLineIndices.add(j);
        }
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
