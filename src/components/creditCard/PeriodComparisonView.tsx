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
import { getCategoryDisplay } from "@/components/transactions/CategoryBadge";
import {
  computePeriodComparison,
  computeChangePercent,
  formatPeriodLabel,
} from "./periodComparison";

export function PeriodComparisonView() {
  const transactions = useTransactionStore((state) => state.transactions);
  const getAllUniqueCards = useCreditCardStore((state) => state.getAllUniqueCards);
  const currency = useSettingsStore((state) => state.currency);

  const hasCCData = getAllUniqueCards().length > 0;

  const [periodMonths, setPeriodMonths] = useState<string>("1");

  const { currentPeriod, previousPeriod, currentData, previousData, change, sortedCategories } =
    useMemo(() => {
      return computePeriodComparison(transactions, parseInt(periodMonths));
    }, [transactions, periodMonths]);

  if (!hasCCData) {
    return null;
  }

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
              {formatPeriodLabel(previousPeriod.start, previousPeriod.end)}
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
              {formatPeriodLabel(currentPeriod.start, currentPeriod.end)}
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
          {sortedCategories.map((catId) => {
            const current = currentData.byCategory.get(catId) || 0;
            const previous = previousData.byCategory.get(catId) || 0;
            const catChange = computeChangePercent(current, previous);
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

          {sortedCategories.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-4">
              No data for comparison
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
