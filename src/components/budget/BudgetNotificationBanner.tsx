'use client';

import { useMemo } from 'react';
import { useBudgetStore } from '@/lib/store/budgetStore';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { getApplicableNotification } from '@/lib/budget/notificationLogic';

export function BudgetNotificationBanner() {
  const router = useRouter();
  const periods = useBudgetStore((s) => s.periods);
  const notifications = useBudgetStore((s) => s.notifications);
  const dismissNotification = useBudgetStore((s) => s.dismissNotification);

  const notification = useMemo(() => {
    const today = new Date();
    const currentMonth = format(today, 'yyyy-MM');
    const nextMonth = format(
      new Date(today.getFullYear(), today.getMonth() + 1, 1),
      'yyyy-MM'
    );

    return getApplicableNotification({
      today,
      currentMonth,
      nextMonth,
      hasCurrentMonthBudget: currentMonth in periods,
      hasNextMonthBudget: nextMonth in periods,
      dismissedNoBudget: notifications.dismissedNoBudget,
      dismissedEOM: notifications.dismissedEOM,
    });
  }, [notifications.dismissedEOM, notifications.dismissedNoBudget, periods]);

  if (!notification) return null;

  const handleAction = () => {
    if (notification.type === 'eom') {
      const currentMonth = format(new Date(), 'yyyy-MM');
      const store = useBudgetStore.getState();
      if (store.getPeriod(currentMonth)) {
        store.carryForward(currentMonth, notification.month);
      }
      router.push(`/budget?tab=plan&month=${notification.month}`);
    } else {
      router.push(`/budget?tab=plan&month=${notification.month}`);
    }
  };

  const handleDismiss = () => {
    dismissNotification(notification.type === 'noBudget' ? 'noBudget' : 'eom', notification.month);
  };

  const monthLabel = format(new Date(notification.month + '-01'), 'MMMM yyyy');

  const message = notification.type === 'noBudget'
    ? `No budget for ${monthLabel}.`
    : `New month starting soon. Set up your ${monthLabel} budget.`;

  const actionLabel = notification.type === 'noBudget' ? 'Set one up' : 'Plan now';
  const dismissLabel = notification.type === 'noBudget' ? 'Dismiss' : 'Remind me later';

  return (
    <div className="flex items-center justify-between gap-4 p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5 mb-4">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
        <span className="text-sm text-yellow-200">{message}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" variant="outline" onClick={handleDismiss} className="text-muted-foreground">
          {dismissLabel}
        </Button>
        <Button size="sm" onClick={handleAction} className="bg-yellow-600 hover:bg-yellow-700 text-white">
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}
