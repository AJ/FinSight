import { describe, it, expect } from 'vitest';
import { groupIntoLines } from '@/lib/parsers/extraction/lineGrouper';
import type { RawTextItem } from '@/lib/parsers/extraction/extractionTypes';

function item(text: string, x: number, y: number, page: number = 1, right?: number): RawTextItem {
  return { text, x, right: right ?? x + text.length * 6, y, page };
}

describe('groupIntoLines', () => {
  it('groups items by y-position into lines', () => {
    const items = [
      item('Date', 10, 100),
      item('Amount', 200, 100),
      item('01-Jan', 10, 80),
      item('500.00', 200, 80),
    ];
    const lines = groupIntoLines(items);
    expect(lines).toHaveLength(2);
    expect(lines[0].y).toBe(100);
    expect(lines[0].items).toHaveLength(2);
    expect(lines[1].y).toBe(80);
    expect(lines[1].items).toHaveLength(2);
  });

  it('sorts items within each line by x ascending', () => {
    const items = [
      item('Amount', 200, 100),
      item('Date', 10, 100),
    ];
    const lines = groupIntoLines(items);
    expect(lines[0].items[0].text).toBe('Date');
    expect(lines[0].items[1].text).toBe('Amount');
  });

  it('groups items within Y_GROUP_TOLERANCE (3px)', () => {
    const items = [
      item('A', 10, 100),
      item('B', 200, 101),
      item('C', 300, 102),
    ];
    const lines = groupIntoLines(items);
    expect(lines).toHaveLength(1);
    expect(lines[0].items).toHaveLength(3);
  });

  it('separates items beyond Y_GROUP_TOLERANCE', () => {
    const items = [
      item('A', 10, 100),
      item('B', 200, 104),
    ];
    const lines = groupIntoLines(items);
    expect(lines).toHaveLength(2);
  });

  it('groups items at exact same y-position', () => {
    const items = [item('A', 10, 100), item('B', 200, 100)];
    const lines = groupIntoLines(items);
    expect(lines).toHaveLength(1);
    expect(lines[0].items).toHaveLength(2);
  });

  it('separates items at exactly Y_GROUP_TOLERANCE distance', () => {
    const items = [item('A', 10, 100), item('B', 200, 103)]; // distance = 3, not < 3
    const lines = groupIntoLines(items);
    expect(lines).toHaveLength(2);
  });

  it('does not group items across pages', () => {
    const items = [
      item('A', 10, 100, 1),
      item('B', 200, 100, 2),
    ];
    const lines = groupIntoLines(items);
    expect(lines).toHaveLength(2);
    expect(lines[0].page).toBe(1);
    expect(lines[1].page).toBe(2);
  });

  it('sorts lines by y descending within each page', () => {
    const items = [
      item('Bottom', 10, 50, 1),
      item('Top', 10, 100, 1),
      item('Middle', 10, 75, 1),
    ];
    const lines = groupIntoLines(items);
    expect(lines.map(l => l.y)).toEqual([100, 75, 50]);
  });

  it('handles empty input', () => {
    expect(groupIntoLines([])).toEqual([]);
  });

  it('keeps all page 1 lines before page 2 lines', () => {
    const items = [
      item('P2-Top', 10, 200, 2),
      item('P1-Top', 10, 300, 1),
      item('P2-Bottom', 10, 100, 2),
      item('P1-Bottom', 10, 50, 1),
    ];
    const lines = groupIntoLines(items);
    expect(lines).toHaveLength(4);
    // All page 1 lines first, then page 2
    expect(lines[0].page).toBe(1);
    expect(lines[1].page).toBe(1);
    expect(lines[2].page).toBe(2);
    expect(lines[3].page).toBe(2);
    // Within each page, y descending
    expect(lines[0].y).toBe(300);
    expect(lines[1].y).toBe(50);
    expect(lines[2].y).toBe(200);
    expect(lines[3].y).toBe(100);
  });
});
