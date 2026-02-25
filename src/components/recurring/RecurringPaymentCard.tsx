'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RecurringPayment } from '@/lib/recurring';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { useRecurringStore } from '@/lib/store/recurringStore';
import { formatCurrency } from '@/lib/currencyFormatter';
import { format } from 'date-fns';
import { AlertTriangle, X, Calendar, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RecurringPaymentCardProps {
  payment: RecurringPayment;
  onDismiss?: () => void;
}

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: '/week',
  monthly: '/month',
  quarterly: '/quarter',
  yearly: '/year',
};

const CATEGORY_ICONS: Record<string, string> = {
  entertainment: '🎬',
  utilities: '💡',
  healthcare: '💪',
  shopping: '🛒',
  food: '🍔',
  transport: '🚗',
  subscriptions: '📱',
  uncategorized: '📦',
};

export function RecurringPaymentCard({ payment, onDismiss }: RecurringPaymentCardProps) {
  const currency = useSettingsStore((state) => state.currency);
  const markAsNotRecurring = useRecurringStore((state) => state.markAsNotRecurring);

  const handleMarkAsNotRecurring = () => {
    markAsNotRecurring(payment.id, payment.merchantName);
  };

  const categoryIcon = CATEGORY_ICONS[payment.category] || CATEGORY_ICONS.uncategorized;
  const frequencyLabel = FREQUENCY_LABELS[payment.frequency] || '';
  const confidencePercent = Math.round(payment.confidence * 100);

  const nextDateStr = payment.nextExpectedDate
    ? format(payment.nextExpectedDate, 'MMM d')
    : 'Unknown';

  const firstSeenStr = format(payment.firstSeen, 'MMM yyyy');
  const lastSeenStr = format(payment.lastSeen, 'MMM d');

  return (
    <Card className={cn(
      'transition-all',
      !payment.isActive && 'border-amber-500/50 bg-amber-500/5'
    )}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Main info */}
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <span className="text-2xl shrink-0">{categoryIcon}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold truncate">{payment.merchantName}</h3>
                {!payment.isActive && (
                  <Badge variant="outline" className="text-amber-500 border-amber-500 shrink-0">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Missed
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground capitalize">
                {payment.category} • Last: {lastSeenStr}
              </p>
            </div>
          </div>

          {/* Amount */}
          <div className="text-right shrink-0">
            <p className="text-lg font-bold">
              {formatCurrency(payment.amount, currency, false)}
              <span className="text-sm font-normal text-muted-foreground">{frequencyLabel}</span>
            </p>
            {payment.averageAmount !== payment.amount && (
              <p className="text-xs text-muted-foreground">
                Avg: {formatCurrency(payment.averageAmount, currency, false)}
              </p>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t my-3" />

        {/* Footer info */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <CheckCircle className="w-3 h-3" />
              {payment.occurrenceCount} payment{payment.occurrenceCount > 1 ? 's' : ''}
            </span>
            <span>Since {firstSeenStr}</span>
            {payment.isActive && (
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Next: {nextDateStr}
              </span>
            )}
            <Badge variant="secondary" className="text-xs">
              {confidencePercent}% confident
            </Badge>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            {onDismiss && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onDismiss}
                className="h-7 px-2 text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkAsNotRecurring}
              className="h-7 px-2 text-muted-foreground hover:text-destructive"
              title="Mark as not recurring"
            >
              Not Recurring
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
