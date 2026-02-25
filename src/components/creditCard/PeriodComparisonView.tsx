"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUp, ArrowDown, Minus, Calendar, TrendingUp, TrendingDown } from "lucide-react";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { getCategoryDisplay } from "@/components/transactions/CategoryBadge";

interface PeriodData {
  total: number;
  byCategory: Map<string, number>;
}

/**
 * Period Comparison View
 *
 * Compares spending between two periods:
 * - Current period vs previous period
 * - Category breakdown comparison
 * - Month-over-month changes
 */
export function PeriodComparisonView() {
  const transactions = useTransactionStore((state) => state.transactions);
  const getAllUniqueCards = useCreditCardStore((state) => state.getAllUniqueCards);
  const currency = useSettingsStore((state) => state.currency);

  const hasCCData = getAllUniqueCards().length > 0;

  // Period selection: compare last N months
  const [periodMonths, setPeriodMonths] = useState<string>("1");

  const { currentPeriod, previousPeriod, currentData, previousData, change } =
    useMemo(() => {
      const months = parseInt(periodMonths);

      // Current period: last N months
      const now = new Date();
      const currentEnd = endOfMonth(now);
      const currentStart = startOfMonth(subMonths(now, months - 1));

      // Previous period: N months before that
      const previousEnd = endOfMonth(subMonths(now, months));
      const previousStart = startOfMonth(subMonths(now, months * 2 - 1));

      // Get CC transactions for each period
      const ccTransactions = transactions.filter(
        (t) => t.sourceType === "credit_card" && t.type === "expense"
      );

      const filterByPeriod = (txns: typeof transactions, start: Date, end: Date) => {
        return txns.filter((t) => {
          const date = t.date instanceof Date ? t.date : new Date(t.date);
          return date >= start && date <= end;
        });
      };

      const currentTxns = filterByPeriod(ccTransactions, currentStart, currentEnd);
      const previousTxns = filterByPeriod(ccTransactions, previousStart, previousEnd);

      // Calculate totals by category
      const calculateData = (txns: typeof transactions): PeriodData => {
        const byCategory = new Map<string, number>();
        let total = 0;

        for (const txn of txns) {
          const cat = txn.category || "uncategorized";
          const amount = Math.abs(txn.amount);
          byCategory.set(cat, (byCategory.get(cat) || 0) + amount);
          total += amount;
        }

        return { total, byCategory };
      };

      const currentData = calculateData(currentTxns);
      const previousData = calculateData(previousTxns);

      const change =
        previousData.total > 0
          ? ((currentData.total - previousData.total) / previousData.total) * 100
          : 0;

      return {
        currentPeriod: { start: currentStart, end: currentEnd },
        previousPeriod: { start: previousStart, end: previousEnd },
        currentData,
        previousData,
        change,
      };
    }, [transactions, periodMonths]);

  // Get all categories from both periods
  const allCategories = useMemo(() => {
    const cats = new Set([
      ...currentData.byCategory.keys(),
      ...previousData.byCategory.keys(),
    ]);
    return Array.from(cats).sort((a, b) => {
      const currentA = currentData.byCategory.get(a) || 0;
      const currentB = currentData.byCategory.get(b) || 0;
      return currentB - currentA;
    });
  }, [currentData.byCategory, previousData.byCategory]);

  // Don't show if no CC data
  if (!hasCCData) {
    return null;
  }

  const formatPeriod = (start: Date, end: Date) => {
    if (start.getMonth() === end.getMonth()) {
      return format(start, "MMM yyyy");
    }
    return `${format(start, "MMM yyyy")} - ${format(end, "MMM yyyy")}`;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="w-4 h-4 text-primary" />
            Period Comparison
          </CardTitle>
          <Select value={periodMonths} onValueChange={setPeriodMonths}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 month</SelectItem>
              <SelectItem value="3">3 months</SelectItem>
              <SelectItem value="6">6 months</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 pb-4 border-b">
          {/* Previous Period */}
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-1">Previous</p>
            <p className="text-xs text-muted-foreground">
              {formatPeriod(previousPeriod.start, previousPeriod.end)}
            </p>
            <p className="font-mono font-semibold mt-1">
              {formatCurrency(previousData.total, currency)}
            </p>
          </div>

          {/* Change */}
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-1">Change</p>
            <div
              className={`flex items-center justify-center gap-1 ${
                change > 0
                  ? "text-destructive"
                  : change < 0
                  ? "text-success"
                  : "text-muted-foreground"
              }`}
            >
              {change > 0 ? (
                <TrendingUp className="w-4 h-4" />
              ) : change < 0 ? (
                <TrendingDown className="w-4 h-4" />
              ) : (
                <Minus className="w-4 h-4" />
              )}
              <span className="font-mono font-semibold">
                {change > 0 ? "+" : ""}
                {change.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Current Period */}
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-1">Current</p>
            <p className="text-xs text-muted-foreground">
              {formatPeriod(currentPeriod.start, currentPeriod.end)}
            </p>
            <p className="font-mono font-semibold mt-1">
              {formatCurrency(currentData.total, currency)}
            </p>
          </div>
        </div>

        {/* Category Comparison */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">
            Category Comparison
          </p>
          {allCategories.map((catId) => {
            const current = currentData.byCategory.get(catId) || 0;
            const previous = previousData.byCategory.get(catId) || 0;
            const catChange =
              previous > 0 ? ((current - previous) / previous) * 100 : 0;
            const display = getCategoryDisplay(catId);
            const IconComponent = display.icon;

            return (
              <div
                key={catId}
                className="flex items-center justify-between p-2 rounded bg-muted/30"
              >
                <div className="flex items-center gap-2">
                  <IconComponent
                    className="w-4 h-4"
                    style={{ color: display.color }}
                  />
                  <span className="text-sm">{display.name}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-mono text-xs text-muted-foreground w-20 text-right">
                    {formatCurrency(previous, currency)}
                  </span>
                  <div
                    className={`w-16 text-right font-mono text-xs ${
                      catChange > 0
                        ? "text-destructive"
                        : catChange < 0
                        ? "text-success"
                        : "text-muted-foreground"
                    }`}
                  >
                    {catChange > 0 ? (
                      <span className="flex items-center justify-end gap-1">
                        <ArrowUp className="w-3 h-3" />+
                        {catChange.toFixed(0)}%
                      </span>
                    ) : catChange < 0 ? (
                      <span className="flex items-center justify-end gap-1">
                        <ArrowDown className="w-3 h-3" />
                        {catChange.toFixed(0)}%
                      </span>
                    ) : (
                      <span>—</span>
                    )}
                  </div>
                  <span className="font-mono text-sm w-20 text-right">
                    {formatCurrency(current, currency)}
                  </span>
                </div>
              </div>
            );
          })}

          {allCategories.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-4">
              No data for comparison
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
