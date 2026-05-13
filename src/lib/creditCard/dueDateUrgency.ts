import type { DueDateItem } from '@/types/creditCard';

export type UrgencyLevel = 'overdue' | 'today' | 'tomorrow' | 'urgent' | 'soon' | 'comfortable';

export interface UrgencyClassification {
  level: UrgencyLevel;
  /** Badge variant for shadcn Badge component */
  badgeVariant: 'destructive' | 'outline' | 'secondary';
  /** CSS text color class */
  textClass: string;
  /** Human-readable label (e.g. "3 days", "Overdue") */
  label: string;
}

export function getDaysUntilDue(dueDate: Date, now: Date = new Date()): number {
  const ref = new Date(now);
  ref.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24));
}

export function classifyUrgency(
  daysUntilDue: number,
  isOverdue: boolean,
): UrgencyClassification {
  if (isOverdue) {
    return {
      level: 'overdue',
      badgeVariant: 'destructive',
      textClass: 'text-destructive',
      label: `${Math.abs(daysUntilDue)} days overdue`,
    };
  }

  if (daysUntilDue === 0) {
    return {
      level: 'today',
      badgeVariant: 'destructive',
      textClass: 'text-destructive',
      label: 'Today',
    };
  }

  if (daysUntilDue === 1) {
    return {
      level: 'tomorrow',
      badgeVariant: 'outline',
      textClass: 'text-destructive',
      label: 'Tomorrow',
    };
  }

  if (daysUntilDue <= 3) {
    return {
      level: 'urgent',
      badgeVariant: 'outline',
      textClass: 'text-amber-600',
      label: `${daysUntilDue} days`,
    };
  }

  if (daysUntilDue <= 7) {
    return {
      level: 'soon',
      badgeVariant: 'secondary',
      textClass: 'text-muted-foreground',
      label: `${daysUntilDue} days`,
    };
  }

  return {
    level: 'comfortable',
    badgeVariant: 'outline',
    textClass: 'text-muted-foreground',
    label: `${daysUntilDue} days`,
  };
}

export function classifyPaidUrgency(): UrgencyClassification {
  return {
    level: 'comfortable',
    badgeVariant: 'secondary',
    textClass: 'text-green-600',
    label: 'Paid',
  };
}

export interface CompactUrgencyInfo {
  badge: 'destructive' | 'outline' | 'secondary';
  text: string;
}

export function getCompactUrgencyInfo(
  item: DueDateItem,
  formattedDate: string,
): CompactUrgencyInfo {
  if (item.isOverdue) {
    return {
      badge: 'destructive',
      text: `${formattedDate} · ${Math.abs(item.daysUntilDue)} days overdue`,
    };
  }

  if (item.daysUntilDue === 0) {
    return { badge: 'destructive', text: 'Today' };
  }

  if (item.daysUntilDue === 1) {
    return { badge: 'outline', text: 'Tomorrow' };
  }

  if (item.daysUntilDue <= 7) {
    return { badge: 'outline', text: `${formattedDate} · ${item.daysUntilDue} days` };
  }

  return { badge: 'secondary', text: `${formattedDate} · ${item.daysUntilDue} days` };
}

export function getDueDateColorClass(isPaid: boolean, daysUntilDue: number): string {
  if (isPaid) return 'text-success';
  const isOverdue = daysUntilDue < 0;
  if (isOverdue) return 'text-destructive';
  if (daysUntilDue <= 7) return 'text-warning';
  return 'text-success';
}

export function getDueDateText(daysUntilDue: number, isPaid: boolean, formattedDate: string): string {
  if (isPaid) return 'Paid';
  const isOverdue = daysUntilDue < 0;
  if (isOverdue) return `${formattedDate} · ${Math.abs(daysUntilDue)} days overdue`;
  if (daysUntilDue === 0) return 'Today';
  if (daysUntilDue === 1) return 'Tomorrow';
  return `${formattedDate} · ${daysUntilDue} days`;
}

export function getCardBorderClass(isPaid: boolean, daysUntilDue: number): string {
  if (isPaid) return '';
  const isOverdue = daysUntilDue < 0;
  if (isOverdue) return 'border-destructive';
  if (daysUntilDue <= 7) return 'border-warning';
  return '';
}
