"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Bar, BarChart as RechartsBarChart, XAxis, YAxis, CartesianGrid, ResponsiveContainer as BarResponsive } from "recharts";
import { CreditCard, ShoppingBag, TrendingUp } from "lucide-react";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";
import { getCategoryDisplay } from "@/components/transactions/CategoryBadge";
import { PeriodComparisonView } from "./PeriodComparisonView";
import {
  filterCCSpendTransactions,
  aggregateByCategory,
  aggregateByCard,
  aggregateByMerchant,
  computeMonthlyTrend,
  computeTotalSpend,
  COLORS,
} from "./spendingAggregation";

/**
 * Spending Tab
 *
 * Shows spending breakdown by:
 * - Category (pie chart)
 * - Card (bar chart)
 * - Top Merchants (list)
 * - Monthly Trend (line chart)
 */

export function SpendingTab() {
  const transactions = useTransactionStore((state) => state.transactions);
  const currency = useSettingsStore((state) => state.currency);

  // Get CC spending transactions only (purchases/charges, not payments/refunds)
  const ccTransactions = useMemo(
    () => filterCCSpendTransactions(transactions),
    [transactions],
  );

  // Category breakdown
  const categoryData = useMemo(
    () => aggregateByCategory(ccTransactions, getCategoryDisplay),
    [ccTransactions],
  );

  // By Card breakdown
  const cardData = useMemo(
    () => aggregateByCard(ccTransactions),
    [ccTransactions],
  );

  // Top Merchants
  const merchantData = useMemo(
    () => aggregateByMerchant(ccTransactions),
    [ccTransactions],
  );

  // Monthly trend (last 6 months)
  const monthlyData = useMemo(
    () => computeMonthlyTrend(ccTransactions),
    [ccTransactions],
  );

  const totalSpend = useMemo(
    () => computeTotalSpend(ccTransactions),
    [ccTransactions],
  );

  if (ccTransactions.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <CreditCard className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Spending Data</h3>
          <p className="text-sm text-muted-foreground">
            Upload a credit card statement to see spending analysis.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Total Spend Summary */}
      <div className="text-sm text-muted-foreground">
        Total CC Spending: <span className="font-semibold text-foreground">{formatCurrency(totalSpend, currency, false)}</span>
        <span className="ml-2">({ccTransactions.length} transactions)</span>
      </div>

      {/* Row 1: Category, By Card, Top Merchants */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* By Category */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="w-4 h-4 text-primary" />
              By Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            {categoryData.length > 0 ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={100} height={100}>
                  <PieChart>
                    <Pie
                      data={categoryData}
                      cx={50}
                      cy={50}
                      innerRadius={25}
                      outerRadius={40}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {categoryData.map((entry, index) => (
                        <Cell key={entry.id} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1.5">
                  {categoryData.slice(0, 5).map((cat, idx) => (
                    <div key={cat.id} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <div
                          className="w-2 h-2 rounded-sm"
                          style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                        />
                        <span className="text-muted-foreground truncate max-w-[80px]">{cat.name}</span>
                      </div>
                      <span className="font-medium">{cat.percentage}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-4">No category data</div>
            )}
          </CardContent>
        </Card>

        {/* By Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CreditCard className="w-4 h-4 text-primary" />
              By Card
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cardData.length > 0 ? (
              <div className="space-y-3">
                {cardData.map((card) => (
                  <div key={card.key} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate max-w-[120px]">{card.label}</span>
                      <span className="font-mono font-medium">{formatCurrency(card.amount, currency, false)}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${card.percentage}%`,
                          backgroundColor: card.color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-4">No card data</div>
            )}
          </CardContent>
        </Card>

        {/* Top Merchants */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShoppingBag className="w-4 h-4 text-primary" />
              Top Merchants
            </CardTitle>
          </CardHeader>
          <CardContent>
            {merchantData.length > 0 ? (
              <div className="space-y-2">
                {merchantData.map((merchant) => (
                  <div
                    key={merchant.name}
                    className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-muted/30 hover:bg-muted/50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{merchant.name}</div>
                      <div className="text-muted-foreground">{merchant.count} txn{merchant.count > 1 ? "s" : ""}</div>
                    </div>
                    <div className="font-mono font-medium">{formatCurrency(merchant.amount, currency)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-4">No merchant data</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Monthly Trend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <TrendingUp className="w-4 h-4 text-primary" />
            Monthly Spending Trend
          </CardTitle>
          <p className="text-xs text-muted-foreground">From statement transaction dates</p>
        </CardHeader>
        <CardContent>
          <BarResponsive width="100%" height={120}>
            <RechartsBarChart data={monthlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.32 0.01 55)" />
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "oklch(0.60 0.01 55)", fontSize: 11 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "oklch(0.60 0.01 55)", fontSize: 11 }}
                tickFormatter={(v) => `${currency.symbol}${v / 1000}k`}
              />
              <Tooltip
                cursor={false}
                contentStyle={{
                  backgroundColor: "oklch(0.20 0.008 55)",
                  border: "1px solid oklch(0.32 0.01 55)",
                  borderRadius: "6px",
                }}
                labelStyle={{ color: "oklch(0.96 0.005 55)" }}
                formatter={(value) => [formatCurrency(value as number, currency), "Spending"]}
              />
              <Bar dataKey="amount" fill="oklch(0.65 0.185 45)" radius={[4, 4, 0, 0]} />
            </RechartsBarChart>
          </BarResponsive>
        </CardContent>
      </Card>

      {/* Row 3: Period Comparison */}
      <PeriodComparisonView />
    </div>
  );
}
