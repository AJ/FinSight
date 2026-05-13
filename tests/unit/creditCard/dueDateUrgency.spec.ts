import { describe, it, expect } from 'vitest';
import {
  getDaysUntilDue,
  classifyUrgency,
  classifyPaidUrgency,
  getCompactUrgencyInfo,
  getDueDateColorClass,
  getDueDateText,
  getCardBorderClass,
} from '@/lib/creditCard/dueDateUrgency';
import type { DueDateItem } from '@/types/creditCard';

function dueItem(daysUntilDue: number, overrides?: Partial<DueDateItem>): DueDateItem {
  return {
    cardIssuer: 'HDFC',
    cardLastFour: '1234',
    dueDate: new Date(2025, 5, 15),
    totalDue: 25000,
    minimumDue: 2500,
    daysUntilDue,
    isOverdue: daysUntilDue < 0,
    ...overrides,
  };
}

describe('getDaysUntilDue', () => {
  it('returns 0 when due date is today', () => {
    const now = new Date(2025, 5, 15);
    const due = new Date(2025, 5, 15);
    expect(getDaysUntilDue(due, now)).toBe(0);
  });

  it('returns positive for future dates', () => {
    const now = new Date(2025, 5, 15);
    const due = new Date(2025, 5, 20);
    expect(getDaysUntilDue(due, now)).toBe(5);
  });

  it('returns negative for past dates', () => {
    const now = new Date(2025, 5, 15);
    const due = new Date(2025, 5, 10);
    expect(getDaysUntilDue(due, now)).toBe(-5);
  });

  it('normalizes hours to midnight', () => {
    const now = new Date(2025, 5, 15, 23, 59, 59);
    const due = new Date(2025, 5, 16, 0, 0, 1);
    expect(getDaysUntilDue(due, now)).toBe(1);
  });

  it('returns 1 for due tomorrow', () => {
    const now = new Date(2025, 5, 15);
    const due = new Date(2025, 5, 16);
    expect(getDaysUntilDue(due, now)).toBe(1);
  });
});

describe('classifyUrgency', () => {
  it('classifies overdue', () => {
    const result = classifyUrgency(-3, true);
    expect(result.level).toBe('overdue');
    expect(result.badgeVariant).toBe('destructive');
    expect(result.label).toBe('3 days overdue');
  });

  it('classifies today', () => {
    const result = classifyUrgency(0, false);
    expect(result.level).toBe('today');
    expect(result.badgeVariant).toBe('destructive');
    expect(result.label).toBe('Today');
  });

  it('classifies tomorrow', () => {
    const result = classifyUrgency(1, false);
    expect(result.level).toBe('tomorrow');
    expect(result.badgeVariant).toBe('outline');
    expect(result.label).toBe('Tomorrow');
  });

  it('classifies urgent (2-3 days)', () => {
    const result = classifyUrgency(3, false);
    expect(result.level).toBe('urgent');
    expect(result.badgeVariant).toBe('outline');
    expect(result.textClass).toBe('text-amber-600');
    expect(result.label).toBe('3 days');
  });

  it('classifies soon (4-7 days)', () => {
    const result = classifyUrgency(7, false);
    expect(result.level).toBe('soon');
    expect(result.badgeVariant).toBe('secondary');
    expect(result.label).toBe('7 days');
  });

  it('classifies comfortable (>7 days)', () => {
    const result = classifyUrgency(14, false);
    expect(result.level).toBe('comfortable');
    expect(result.badgeVariant).toBe('outline');
    expect(result.label).toBe('14 days');
  });

  it('classifies 2 days as urgent', () => {
    const result = classifyUrgency(2, false);
    expect(result.level).toBe('urgent');
  });

  it('classifies 4 days as soon', () => {
    const result = classifyUrgency(4, false);
    expect(result.level).toBe('soon');
  });

  it('classifies 8 days as comfortable', () => {
    const result = classifyUrgency(8, false);
    expect(result.level).toBe('comfortable');
  });
});

describe('classifyPaidUrgency', () => {
  it('returns paid classification', () => {
    const result = classifyPaidUrgency();
    expect(result.label).toBe('Paid');
    expect(result.textClass).toBe('text-green-600');
    expect(result.badgeVariant).toBe('secondary');
  });
});

describe('getCompactUrgencyInfo', () => {
  it('handles overdue items', () => {
    const item = dueItem(-5, { isOverdue: true });
    const result = getCompactUrgencyInfo(item, 'Jun 15');
    expect(result.badge).toBe('destructive');
    expect(result.text).toContain('5 days overdue');
  });

  it('handles due today', () => {
    const item = dueItem(0);
    const result = getCompactUrgencyInfo(item, 'Jun 15');
    expect(result.badge).toBe('destructive');
    expect(result.text).toBe('Today');
  });

  it('handles due tomorrow', () => {
    const item = dueItem(1);
    const result = getCompactUrgencyInfo(item, 'Jun 15');
    expect(result.badge).toBe('outline');
    expect(result.text).toBe('Tomorrow');
  });

  it('handles within 7 days', () => {
    const item = dueItem(5);
    const result = getCompactUrgencyInfo(item, 'Jun 15');
    expect(result.badge).toBe('outline');
    expect(result.text).toBe('Jun 15 · 5 days');
  });

  it('handles beyond 7 days', () => {
    const item = dueItem(15);
    const result = getCompactUrgencyInfo(item, 'Jun 15');
    expect(result.badge).toBe('secondary');
    expect(result.text).toBe('Jun 15 · 15 days');
  });
});

describe('getDueDateColorClass', () => {
  it('returns success for paid', () => {
    expect(getDueDateColorClass(true, 5)).toBe('text-success');
  });

  it('returns destructive for overdue', () => {
    expect(getDueDateColorClass(false, -1)).toBe('text-destructive');
  });

  it('returns warning for due soon', () => {
    expect(getDueDateColorClass(false, 3)).toBe('text-warning');
  });

  it('returns success for comfortable', () => {
    expect(getDueDateColorClass(false, 15)).toBe('text-success');
  });

  it('returns warning at boundary 7', () => {
    expect(getDueDateColorClass(false, 7)).toBe('text-warning');
  });

  it('returns success at boundary 8', () => {
    expect(getDueDateColorClass(false, 8)).toBe('text-success');
  });
});

describe('getDueDateText', () => {
  it('returns Paid for paid statements', () => {
    expect(getDueDateText(5, true, 'Jun 15')).toBe('Paid');
  });

  it('returns overdue text', () => {
    expect(getDueDateText(-3, false, 'Jun 15')).toBe('Jun 15 · 3 days overdue');
  });

  it('returns Today', () => {
    expect(getDueDateText(0, false, 'Jun 15')).toBe('Today');
  });

  it('returns Tomorrow', () => {
    expect(getDueDateText(1, false, 'Jun 15')).toBe('Tomorrow');
  });

  it('returns days text for future dates', () => {
    expect(getDueDateText(5, false, 'Jun 15')).toBe('Jun 15 · 5 days');
  });
});

describe('getCardBorderClass', () => {
  it('returns empty for paid', () => {
    expect(getCardBorderClass(true, 5)).toBe('');
  });

  it('returns destructive for overdue', () => {
    expect(getCardBorderClass(false, -1)).toBe('border-destructive');
  });

  it('returns warning for due soon', () => {
    expect(getCardBorderClass(false, 3)).toBe('border-warning');
  });

  it('returns empty for comfortable', () => {
    expect(getCardBorderClass(false, 15)).toBe('');
  });
});
