import { describe, it, expect } from 'vitest';
import { getApplicableNotification } from '@/lib/budget/notificationLogic';

describe('getApplicableNotification', () => {
  const may2026 = '2026-05';
  const apr2026 = '2026-04';

  it('returns null when current month has a budget and it is not the 28th', () => {
    const result = getApplicableNotification({
      today: new Date('2026-04-15'),
      currentMonth: apr2026,
      nextMonth: may2026,
      hasCurrentMonthBudget: true,
      hasNextMonthBudget: false,
      dismissedNoBudget: null,
      dismissedEOM: null,
    });
    expect(result).toBeNull();
  });

  it('returns "no budget" toast when no budget for current month (before 28th)', () => {
    const result = getApplicableNotification({
      today: new Date('2026-04-15'),
      currentMonth: apr2026,
      nextMonth: may2026,
      hasCurrentMonthBudget: false,
      hasNextMonthBudget: false,
      dismissedNoBudget: null,
      dismissedEOM: null,
    });
    expect(result).toEqual({ type: 'noBudget', month: apr2026 });
  });

  it('returns null when "no budget" was already dismissed for this month', () => {
    const result = getApplicableNotification({
      today: new Date('2026-04-15'),
      currentMonth: apr2026,
      nextMonth: may2026,
      hasCurrentMonthBudget: false,
      hasNextMonthBudget: false,
      dismissedNoBudget: apr2026,
      dismissedEOM: null,
    });
    expect(result).toBeNull();
  });

  it('returns EOM reminder on 28th when no budget for next month', () => {
    const result = getApplicableNotification({
      today: new Date('2026-04-28'),
      currentMonth: apr2026,
      nextMonth: may2026,
      hasCurrentMonthBudget: true,
      hasNextMonthBudget: false,
      dismissedNoBudget: null,
      dismissedEOM: null,
    });
    expect(result).toEqual({ type: 'eom', month: may2026 });
  });

  it('EOM reminder supersedes "no budget" toast (both apply)', () => {
    const result = getApplicableNotification({
      today: new Date('2026-04-28'),
      currentMonth: apr2026,
      nextMonth: may2026,
      hasCurrentMonthBudget: false,
      hasNextMonthBudget: false,
      dismissedNoBudget: null,
      dismissedEOM: null,
    });
    expect(result).toEqual({ type: 'eom', month: may2026 });
  });

  it('falls through to "no budget" when EOM was dismissed', () => {
    const result = getApplicableNotification({
      today: new Date('2026-04-28'),
      currentMonth: apr2026,
      nextMonth: may2026,
      hasCurrentMonthBudget: false,
      hasNextMonthBudget: false,
      dismissedNoBudget: null,
      dismissedEOM: may2026,
    });
    expect(result).toEqual({ type: 'noBudget', month: apr2026 });
  });

  it('returns null when both dismissed', () => {
    const result = getApplicableNotification({
      today: new Date('2026-04-28'),
      currentMonth: apr2026,
      nextMonth: may2026,
      hasCurrentMonthBudget: false,
      hasNextMonthBudget: false,
      dismissedNoBudget: apr2026,
      dismissedEOM: may2026,
    });
    expect(result).toBeNull();
  });

  it('returns null when next month has budget (after 28th)', () => {
    const result = getApplicableNotification({
      today: new Date('2026-04-28'),
      currentMonth: apr2026,
      nextMonth: may2026,
      hasCurrentMonthBudget: true,
      hasNextMonthBudget: true,
      dismissedNoBudget: null,
      dismissedEOM: null,
    });
    expect(result).toBeNull();
  });
});
