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

/**
 * Spending Tab
 *
 * Shows spending breakdown by:
 * - Category (pie chart)
 * - Card (bar chart)
 * - Top Merchants (list)
 * - Monthly Trend (line chart)
 */

const COLORS = [
  "oklch(0.65 0.185 45)",   // primary orange
  "oklch(0.65 0.15 220)",   // blue
  "oklch(0.68 0.14 150)",   // green
  "oklch(0.75 0.15 70)",    // yellow
  "oklch(0.70 0.15 300)",   // purple
  "oklch(0.60 0.12 180)",   // cyan
];

export function SpendingTab() {
  const transactions = useTransactionStore((state) => state.transactions);
  const currency = useSettingsStore((state) => state.currency);

  // Get CC spending transactions only (purchases/charges, not payments/refunds)
  const ccTransactions = useMemo(() => {
    return transactions.filter((t) => t.sourceType === "credit_card" && t.isDebit);
  }, [transactions]);

  // Category breakdown
  const categoryData = useMemo(() => {
    const byCategory: Record<string, number> = {};

    for (const txn of ccTransactions) {
      const catId = txn.category?.id || "uncategorized";
      byCategory[catId] = (byCategory[catId] || 0) + Math.abs(txn.amount);
    }

    const total = Object.values(byCategory).reduce((sum, v) => sum + v, 0);

    return Object.entries(byCategory)
      .map(([catId, amount]) => {
        const display = getCategoryDisplay(catId);
        return {
          id: catId,
          name: display.name,
          value: amount,
          percentage: total > 0 ? Math.round((amount / total) * 100) : 0,
          color: display.color,
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [ccTransactions]);

  // By Card breakdown
  const cardData = useMemo(() => {
    const byCard: Record<string, { issuer: string; lastFour: string; amount: number }> = {};

    for (const txn of ccTransactions) {
      if (!txn.cardIssuer || !txn.cardLastFour) continue;
      const key = `${txn.cardIssuer}-${txn.cardLastFour}`;
      if (!byCard[key]) {
        byCard[key] = { issuer: txn.cardIssuer, lastFour: txn.cardLastFour, amount: 0 };
      }
      byCard[key].amount += Math.abs(txn.amount);
    }

    const total = Object.values(byCard).reduce((sum, c) => sum + c.amount, 0);

    return Object.entries(byCard)
      .map(([key, data], idx) => ({
        key,
        label: `${data.issuer.split(" ")[0]} ****${data.lastFour}`,
        amount: data.amount,
        percentage: total > 0 ? Math.round((data.amount / total) * 100) : 0,
        color: COLORS[idx % COLORS.length],
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [ccTransactions]);

  // Top Merchants
  const merchantData = useMemo(() => {
    const byMerchant: Record<string, { count: number; amount: number }> = {};

    for (const txn of ccTransactions) {
      // Simple merchant extraction - first word or two of description
      const desc = txn.description?.trim() || "Unknown";
      const merchant = desc.split(/\s+/).slice(0, 2).join(" ").substring(0, 20);

      if (!byMerchant[merchant]) {
        byMerchant[merchant] = { count: 0, amount: 0 };
      }
      byMerchant[merchant].count += 1;
      byMerchant[merchant].amount += Math.abs(txn.amount);
    }

    return Object.entries(byMerchant)
      .map(([name, data]) => ({
        name,
        count: data.count,
        amount: data.amount,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [ccTransactions]);

  // Monthly trend (last 6 months)
  const monthlyData = useMemo(() => {
    const byMonth: Record<string, number> = {};
    const now = new Date();

    // Initialize last 6 months
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      byMonth[key] = 0;
    }

    for (const txn of ccTransactions) {
      const d = new Date(txn.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (key in byMonth) {
        byMonth[key] += Math.abs(txn.amount);
      }
    }

    return Object.entries(byMonth).map(([month, amount]) => ({
      month: new Date(month + "-01").toLocaleDateString("en-IN", { month: "short" }),
      amount,
    }));
  }, [ccTransactions]);

  const totalSpend = useMemo(() => {
    return ccTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }, [ccTransactions]);

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
                tickFormatter={(v) => `₹${v / 1000}k`}
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
    </div>
  );
}
