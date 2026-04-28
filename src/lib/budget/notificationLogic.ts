export interface NotificationInput {
  today: Date;
  currentMonth: string;
  nextMonth: string;
  hasCurrentMonthBudget: boolean;
  hasNextMonthBudget: boolean;
  dismissedNoBudget: string | null;
  dismissedEOM: string | null;
}

export type NotificationType = { type: 'noBudget'; month: string } | { type: 'eom'; month: string };

export function getApplicableNotification(input: NotificationInput): NotificationType | null {
  const { today, currentMonth, nextMonth, hasCurrentMonthBudget, hasNextMonthBudget, dismissedNoBudget, dismissedEOM } = input;
  const dayOfMonth = today.getDate();

  if (dayOfMonth >= 28 && !hasNextMonthBudget && dismissedEOM !== nextMonth) {
    return { type: 'eom', month: nextMonth };
  }

  if (!hasCurrentMonthBudget && dismissedNoBudget !== currentMonth) {
    return { type: 'noBudget', month: currentMonth };
  }

  return null;
}
