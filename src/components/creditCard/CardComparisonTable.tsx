"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreditCard, ArrowUpDown } from "lucide-react";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { getCategoryDisplay } from "@/components/transactions/CategoryBadge";

type SortKey = "totalSpend" | "transactionCount" | "utilization";

/**
 * Card Comparison Table
 *
 * Side-by-side comparison of credit cards showing:
 * - Total spend per card
 * - Transaction count
 * - Utilization
 * - Category breakdown
 */
export function CardComparisonTable() {
  const transactions = useTransactionStore((state) => state.transactions);
  const getCardComparison = useCreditCardStore((state) => state.getCardComparison);
  const currency = useSettingsStore((state) => state.currency);

  const [sortKey, setSortKey] = useState<SortKey>("totalSpend");
  const [sortDesc, setSortDesc] = useState(true);

  // Default to current month
  const periodStart = startOfMonth(new Date());
  const periodEnd = endOfMonth(new Date());

  const comparison = useMemo(() => {
    return getCardComparison(transactions, periodStart, periodEnd);
  }, [transactions, getCardComparison, periodStart, periodEnd]);

  // Don't show if no CC data
  if (comparison.length === 0) {
    return null;
  }

  // Sort comparison data
  const sortedComparison = [...comparison].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    return sortDesc ? bVal - aVal : aVal - bVal;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  // Get top categories for a card
  const getTopCategories = (breakdown: Record<string, number>) => {
    return Object.entries(breakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="w-4 h-4 text-primary" />
          Card Comparison
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {format(periodStart, "MMM yyyy")}
        </p>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Card</TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => toggleSort("totalSpend")}
                >
                  <div className="flex items-center gap-1">
                    Spend
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => toggleSort("transactionCount")}
                >
                  <div className="flex items-center gap-1">
                    Txns
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => toggleSort("utilization")}
                >
                  <div className="flex items-center gap-1">
                    Utilization
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </TableHead>
                <TableHead>Top Categories</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedComparison.map((card) => {
                const topCategories = getTopCategories(card.categoryBreakdown);
                const utilPercent = Math.round(card.utilization * 100);
                const utilColor =
                  card.utilization < 0.3
                    ? "text-success"
                    : card.utilization < 0.5
                    ? "text-amber-600"
                    : "text-destructive";

                return (
                  <TableRow key={card.cardLabel}>
                    <TableCell className="font-medium">
                      {card.cardIssuer} ****{card.cardLastFour}
                    </TableCell>
                    <TableCell className="font-mono">
                      {formatCurrency(card.totalSpend, currency)}
                    </TableCell>
                    <TableCell>{card.transactionCount}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className={`font-mono text-sm ${utilColor}`}>
                          {utilPercent}%
                        </div>
                        <Progress value={utilPercent} className="h-1.5" />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {topCategories.map(([catId, amount]) => {
                          const display = getCategoryDisplay(catId);
                          const IconComponent = display.icon;
                          return (
                            <Badge
                              key={catId}
                              variant="outline"
                              className="text-xs gap-1"
                            >
                              <IconComponent
                                className="w-3 h-3"
                                style={{ color: display.color }}
                              />
                              {formatCurrency(amount, currency)}
                            </Badge>
                          );
                        })}
                        {topCategories.length === 0 && (
                          <span className="text-xs text-muted-foreground">
                            No data
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
