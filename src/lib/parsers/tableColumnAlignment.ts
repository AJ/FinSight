import type { StatementTableInfo } from './extraction/extractionTypes';
import { debugLog, debugWarn } from '@/lib/utils/debug';

const headerKey = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

function headerLayout(cells: string[]) {
  const names: string[] = [];
  const gaps = [0];
  for (const cell of cells) {
    const name = headerKey(cell);
    if (name) {
      names.push(name);
      gaps.push(0);
    } else {
      gaps[gaps.length - 1]++;
    }
  }
  return { names, gaps };
}

function padCells(cells: string[], gaps: number[], sharedGaps: number[]): string[] {
  const result: string[] = [];
  let cursor = 0;
  for (let gap = 0; gap < gaps.length; gap++) {
    for (let slot = 0; slot < sharedGaps[gap]; slot++) {
      result.push(slot < gaps[gap] ? cells[cursor++] ?? '' : '');
    }
    if (gap < gaps.length - 1) result.push(cells[cursor++] ?? '');
  }
  return result;
}

/**
 * Request-only padding for repeated tables with identical ordered header names.
 * Unnamed cells stay in order within each gap; their meaning is never inferred.
 * No source lines are added, removed or merged.
 */
export function alignTableColumns(text: string, tables: StatementTableInfo[]): string {
  const lines = text.split('\n');
  const ownership = new Map<number, number>();
  const groups = new Map<string, StatementTableInfo[]>();
  debugLog('cc_column_alignment', 'Input metadata', { tableCount: tables.length });
  for (const table of tables) {
    for (const index of [table.headerLineIndex, ...table.dataRowLineIndexes]) {
      ownership.set(index, (ownership.get(index) ?? 0) + 1);
    }
    const { names } = headerLayout(table.columns.map(column => column.headerText));
    if (names.length === 0 || new Set(names).size !== names.length) {
      debugLog('cc_column_alignment', 'Skipped unnamed or ambiguous header', { headerLineIndex: table.headerLineIndex });
      continue;
    }
    const key = JSON.stringify(names);
    groups.set(key, [...(groups.get(key) ?? []), table]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) {
      debugLog('cc_column_alignment', 'No matching repeated header', { headerLineIndex: group[0].headerLineIndex });
      continue;
    }
    // A mismatched header or overlapping ownership makes the whole family unsafe
    // to align. Retain its original representation rather than guess cell roles.
    if (!group.every(table => validTable(table, lines, ownership))) {
      debugWarn('cc_column_alignment', 'Retained original columns: inconsistent table metadata',
        { headerLineIndexes: group.map(table => table.headerLineIndex) });
      continue;
    }
    const layouts = group.map(table => {
      const indexes = [table.headerLineIndex, ...table.dataRowLineIndexes];
      const width = Math.max(...indexes.map(index => lines[index].split('||').length));
      const { gaps } = headerLayout(table.columns.map(column => column.headerText));
      // Formatter overflow cells have no header, but must survive alignment too.
      gaps[gaps.length - 1] += Math.max(0, width - table.columns.length);
      return { indexes, gaps };
    });
    const sharedGaps = layouts[0].gaps.map((_, gap) =>
      Math.max(...layouts.map(layout => layout.gaps[gap])));
    debugLog('cc_column_alignment', {
      headerLineIndexes: group.map(table => table.headerLineIndex), sharedGaps,
    });
    for (const { indexes, gaps } of layouts) {
      for (const index of indexes) {
        lines[index] = padCells(lines[index].split('||'), gaps, sharedGaps).join('||');
      }
    }
  }
  return lines.join('\n');
}

function validTable(table: StatementTableInfo, lines: string[], ownership: Map<number, number>): boolean {
  const indexes = [table.headerLineIndex, ...table.dataRowLineIndexes];
  if (!indexes.every(index => Number.isInteger(index) && index >= 0
    && index < lines.length && ownership.get(index) === 1)) return false;
  const header = lines[table.headerLineIndex].split('||');
  return table.columns.every((column, index) =>
    headerKey(column.headerText) === headerKey(header[index] ?? ''))
    && header.slice(table.columns.length).every(cell => headerKey(cell) === '');
}
