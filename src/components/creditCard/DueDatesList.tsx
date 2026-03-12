"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, AlertTriangle, Clock, CheckCircle2, Check } from "lucide-react";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";
import { format } from "date-fns";

interface DueDateItemWithStatement {
  cardIssuer: string;
  cardLastFour: string;
  dueDate: Date;
  totalDue: number;
  minimumDue: number;
  daysUntilDue: number;
  isOverdue: boolean;
  statementId?: string;
}

interface DueDatesListProps {
  /** Compact mode shows only the most urgent payment */
  compact?: boolean;
}

/**
 * Due Dates List
 *
 * Shows upcoming credit card payment due dates sorted by urgency.
 * Helps users plan payments and avoid late fees.
 *
 * In compact mode, shows only the most urgent payment as a KPI card.
 */
export function DueDatesList({ compact = false }: DueDatesListProps) {
  const getDueDates = useCreditCardStore((state) => state.getDueDates);
  const getMostRecentStatement = useCreditCardStore((state) => state.getMostRecentStatement);
  const markStatementPaid = useCreditCardStore((state) => state.markStatementPaid);
  const currency = useSettingsStore((state) => state.currency);
  const [paidCards, setPaidCards] = useState<Set<string>>(new Set());

  const dueDates = useMemo(() => {
    const dates = getDueDates();
    // Enhance with statement ID for marking as paid
    return dates.map((item): DueDateItemWithStatement => {
      const recent = getMostRecentStatement(item.cardIssuer, item.cardLastFour);
      return {
        ...item,
        statementId: recent?.id,
      };
    });
  }, [getDueDates, getMostRecentStatement]);

  // Handle compact mode first - show "All caught up!" if no due dates
  if (compact) {
    const relevantDueDates = dueDates.filter(
      (item) => !item.isOverdue || Math.abs(item.daysUntilDue) <= 30
    );

    const mostUrgent = relevantDueDates[0];

    // If no relevant due dates, show a "all caught up" message
    if (!mostUrgent) {
      return (
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Next Payment Due
            </div>
            <div className="text-2xl font-bold mt-1.5 text-success">
              All caught up!
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              No upcoming payments
            </div>
          </CardContent>
        </Card>
      );
    }

    const dueDate = mostUrgent.dueDate instanceof Date
      ? mostUrgent.dueDate
      : new Date(mostUrgent.dueDate);

    const getUrgencyInfo = () => {
      if (mostUrgent.isOverdue) {
        return {
          badge: "destructive" as const,
          text: `${format(dueDate, "MMM d")} · ${Math.abs(mostUrgent.daysUntilDue)} days overdue`,
        };
      }
      if (mostUrgent.daysUntilDue === 0) {
        return { badge: "destructive" as const, text: "Today" };
      }
      if (mostUrgent.daysUntilDue === 1) {
        return { badge: "outline" as const, text: "Tomorrow" };
      }
      if (mostUrgent.daysUntilDue <= 7) {
        return { badge: "outline" as const, text: `${format(dueDate, "MMM d")} · ${mostUrgent.daysUntilDue} days` };
      }
      return { badge: "secondary" as const, text: `${format(dueDate, "MMM d")} · ${mostUrgent.daysUntilDue} days` };
    };

    const urgency = getUrgencyInfo();

    return (
      <Card>
        <CardContent className="p-4">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Next Payment Due
          </div>
          <div className="text-2xl font-bold mt-1.5">
            {formatCurrency(mostUrgent.totalDue, currency)}
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge variant={urgency.badge}>{urgency.text}</Badge>
            <span className="text-xs text-muted-foreground">
              {mostUrgent.cardIssuer}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Don't show non-compact card if no CC data
  if (dueDates.length === 0) {
    return null;
  }

  // Get status for a due date
  const getStatus = (item: DueDateItemWithStatement): {
    variant: "default" | "secondary" | "destructive" | "outline";
    icon: React.ReactNode;
    label: string;
    className: string;
  } => {
    const cardKey = `${item.cardIssuer}-${item.cardLastFour}`;
    if (paidCards.has(cardKey)) {
      return {
        variant: "secondary",
        icon: <Check className="w-3 h-3" />,
        label: "Paid",
        className: "text-green-600",
      };
    }

    if (item.isOverdue) {
      return {
        variant: "destructive",
        icon: <AlertTriangle className="w-3 h-3" />,
        label: "Overdue",
        className: "text-destructive",
      };
    } else if (item.daysUntilDue === 0) {
      return {
        variant: "destructive",
        icon: <AlertTriangle className="w-3 h-3" />,
        label: "Due Today",
        className: "text-destructive",
      };
    } else if (item.daysUntilDue <= 3) {
      return {
        variant: "outline",
        icon: <Clock className="w-3 h-3" />,
        label: `${item.daysUntilDue} day${item.daysUntilDue > 1 ? "s" : ""}`,
        className: "text-amber-600",
      };
    } else if (item.daysUntilDue <= 7) {
      return {
        variant: "secondary",
        icon: <Clock className="w-3 h-3" />,
        label: `${item.daysUntilDue} days`,
        className: "text-muted-foreground",
      };
    } else {
      return {
        variant: "outline",
        icon: <CheckCircle2 className="w-3 h-3" />,
        label: `${item.daysUntilDue} days`,
        className: "text-muted-foreground",
      };
    }
  };

  const handleMarkPaid = (item: DueDateItemWithStatement) => {
    const cardKey = `${item.cardIssuer}-${item.cardLastFour}`;
    if (item.statementId) {
      markStatementPaid(item.statementId, new Date(), item.totalDue);
      setPaidCards((prev) => new Set(prev).add(cardKey));
    }
  };

  const unpaidDueDates = dueDates.filter(
    (item) => !paidCards.has(`${item.cardIssuer}-${item.cardLastFour}`)
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Calendar className="w-4 h-4 text-primary" />
          Payment Due Dates
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {dueDates.map((item) => {
          const status = getStatus(item);
          const dueDate = item.dueDate instanceof Date
            ? item.dueDate
            : new Date(item.dueDate);
          const cardKey = `${item.cardIssuer}-${item.cardLastFour}`;
          const isPaid = paidCards.has(cardKey);

          return (
            <div
              key={cardKey}
              className={`flex items-center justify-between p-2 rounded-lg ${isPaid ? 'bg-muted/30 hover:bg-muted/50':'bg-muted/10 hover:bg-muted/20'}`}
            >
              <div className="space-y-0.5 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {item.cardIssuer} ****{item.cardLastFour}
                  </span>
                  <Badge variant={status.variant} className="text-xs gap-1">
                    {status.icon}
                    {status.label}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  Due: {format(dueDate, "MMM dd, yyyy")}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className={`font-mono text-sm font-semibold ${status.className}`}>
                    {formatCurrency(item.totalDue, currency)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Min: {formatCurrency(item.minimumDue, currency)}
                  </div>
                </div>
                {!isPaid && item.statementId && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => handleMarkPaid(item)}
                  >
                    <Check className="w-3 h-3 mr-1" />
                    Paid
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {/* Summary warning if any overdue */}
        {unpaidDueDates.some((d) => d.isOverdue) && (
          <div className="flex items-center gap-2 text-xs text-destructive pt-2 border-t">
            <AlertTriangle className="w-3 h-3" />
            <span>Pay overdue bills immediately to avoid additional fees</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
