"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";
import { format } from "date-fns";

/**
 * Due Dates List
 *
 * Shows upcoming credit card payment due dates sorted by urgency.
 * Helps users plan payments and avoid late fees.
 */
export function DueDatesList() {
  const getDueDates = useCreditCardStore((state) => state.getDueDates);
  const currency = useSettingsStore((state) => state.currency);

  const dueDates = useMemo(() => getDueDates(), [getDueDates]);

  // Don't show if no CC data
  if (dueDates.length === 0) {
    return null;
  }

  // Get status for a due date
  const getStatus = (item: typeof dueDates[0]): {
    variant: "default" | "secondary" | "destructive" | "outline";
    icon: React.ReactNode;
    label: string;
    className: string;
  } => {
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

          return (
            <div
              key={`${item.cardIssuer}-${item.cardLastFour}`}
              className="flex items-center justify-between p-2 rounded-lg bg-muted/30"
            >
              <div className="space-y-0.5">
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
              <div className="text-right">
                <div className={`font-mono text-sm font-semibold ${status.className}`}>
                  {formatCurrency(item.totalDue, currency)}
                </div>
                <div className="text-xs text-muted-foreground">
                  Min: {formatCurrency(item.minimumDue, currency)}
                </div>
              </div>
            </div>
          );
        })}

        {/* Summary warning if any overdue */}
        {dueDates.some((d) => d.isOverdue) && (
          <div className="flex items-center gap-2 text-xs text-destructive pt-2 border-t">
            <AlertTriangle className="w-3 h-3" />
            <span>Pay overdue bills immediately to avoid additional fees</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
