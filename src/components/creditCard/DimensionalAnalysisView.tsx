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
import { Button } from "@/components/ui/button";
import { PieChart, BarChart3, TableIcon } from "lucide-react";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";
import {
  GroupingDimension,
  groupTransactions,
  GroupedSpending,
} from "@/lib/creditCard/dimensionalAnalysis";
import { SpendingPieChart } from "./SpendingPieChart";
import { SpendingBarChart } from "./SpendingBarChart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";

const DIMENSIONS: { value: GroupingDimension; label: string }[] = [
  { value: "category", label: "Category" },
  { value: "card", label: "Card" },
  { value: "amountRange", label: "Amount Range" },
  { value: "country", label: "India vs International" },
  { value: "cardHolder", label: "Card Holder" },
];

/**
 * Dimensional Analysis View
 *
 * Allows users to analyze spending by different dimensions:
 * - Category
 * - Card
 * - Amount Range
 * - Country (India vs International)
 * - Card Holder (Primary vs Addon)
 *
 * Supports pie chart, bar chart, and table views.
 */
export function DimensionalAnalysisView() {
  const transactions = useTransactionStore((state) => state.transactions);
  const getAllUniqueCards = useCreditCardStore((state) => state.getAllUniqueCards);
  const currency = useSettingsStore((state) => state.currency);

  const hasCCData = getAllUniqueCards().length > 0;

  const [dimension, setDimension] = useState<GroupingDimension>("category");
  const [viewType, setViewType] = useState<"pie" | "bar" | "table">("pie");

  // Filter to only CC transactions for CC analysis
  const ccTransactions = useMemo(() => {
    if (!hasCCData) return [];
    return transactions.filter((t) => t.sourceType === "credit_card");
  }, [transactions, hasCCData]);

  const groupedData: GroupedSpending[] = useMemo(() => {
    if (!hasCCData) return [];
    return groupTransactions(ccTransactions, dimension);
  }, [ccTransactions, dimension, hasCCData]);

  const total = useMemo(() => {
    return groupedData.reduce((sum, g) => sum + g.amount, 0);
  }, [groupedData]);

  // Don't show if no CC data
  if (!hasCCData) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <PieChart className="w-4 h-4 text-primary" />
            Spending Analysis
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Dimension Selector */}
            <Select
              value={dimension}
              onValueChange={(v) => setDimension(v as GroupingDimension)}
            >
              <SelectTrigger className="w-[150px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIMENSIONS.map((dim) => (
                  <SelectItem key={dim.value} value={dim.value}>
                    {dim.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* View Type Toggle */}
            <div className="flex border rounded-md">
              <Button
                variant={viewType === "pie" ? "default" : "ghost"}
                size="icon"
                className="h-8 w-8 rounded-r-none"
                onClick={() => setViewType("pie")}
              >
                <PieChart className="w-4 h-4" />
              </Button>
              <Button
                variant={viewType === "bar" ? "default" : "ghost"}
                size="icon"
                className="h-8 w-8 rounded-none border-x"
                onClick={() => setViewType("bar")}
              >
                <BarChart3 className="w-4 h-4" />
              </Button>
              <Button
                variant={viewType === "table" ? "default" : "ghost"}
                size="icon"
                className="h-8 w-8 rounded-l-none"
                onClick={() => setViewType("table")}
              >
                <TableIcon className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Total */}
        <div className="flex items-center justify-between mb-4 pb-2 border-b">
          <span className="text-sm text-muted-foreground">Total Spending</span>
          <span className="font-mono font-semibold">
            {formatCurrency(total, currency)}
          </span>
        </div>

        {/* Chart Views */}
        {viewType === "pie" && (
          <SpendingPieChart data={groupedData} doughnut />
        )}

        {viewType === "bar" && (
          <SpendingBarChart data={groupedData} horizontal />
        )}

        {viewType === "table" && (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Group</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="w-[150px]">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No data to display
                    </TableCell>
                  </TableRow>
                ) : (
                  groupedData.map((item) => (
                    <TableRow key={item.key}>
                      <TableCell className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded"
                          style={{ backgroundColor: item.color }}
                        />
                        {item.label}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(item.amount, currency)}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.transactionCount}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress
                            value={item.percentage}
                            className="h-2 flex-1"
                          />
                          <span className="text-xs text-muted-foreground w-10 text-right">
                            {item.percentage.toFixed(1)}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
