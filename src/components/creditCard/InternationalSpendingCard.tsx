"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe, MapPin, DollarSign } from "lucide-react";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";
import {
  computeInternationalSummary,
  getCurrencySymbol,
} from "./internationalSpendingCalculation";

/**
 * International Spending Card
 *
 * Shows spending in foreign currencies:
 * - Currency breakdown
 * - Original amounts and INR equivalents
 * - Transaction count per currency
 */
export function InternationalSpendingCard() {
  const transactions = useTransactionStore((state) => state.transactions);
  const currency = useSettingsStore((state) => state.currency);

  const internationalData = useMemo(
    () => computeInternationalSummary(transactions),
    [transactions],
  );

  // Don't show if no international transactions
  if (!internationalData || internationalData.currencies.length === 0) {
    return null;
  }

  const { currencies, totalInr, totalTxns } = internationalData;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="w-4 h-4 text-primary" />
          International Spending
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="flex items-center justify-between pb-2 border-b">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="w-3 h-3" />
            <span>Total in {currencies.length} currencies</span>
          </div>
          <div className="text-right">
            <div className="font-mono font-medium">
              {formatCurrency(totalInr, currency)}
            </div>
            <div className="text-xs text-muted-foreground">
              {totalTxns} transactions
            </div>
          </div>
        </div>

        {/* Currency breakdown */}
        <div className="space-y-2">
          {currencies.map((curr) => {
            const percent = Math.round((curr.inrAmount / totalInr) * 100);

            return (
              <div
                key={curr.currency}
                className="flex items-center justify-between p-2 rounded bg-muted/30"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">
                    {getCurrencySymbol(curr.currency)} {curr.currency}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {curr.transactionCount} txn{curr.transactionCount > 1 ? "s" : ""}
                  </span>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm">
                    {curr.originalAmount.toFixed(2)} {curr.currency}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ≈ {formatCurrency(curr.inrAmount, currency)} ({percent}%)
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Info note */}
        <p className="text-xs text-muted-foreground flex items-start gap-1">
          <DollarSign className="w-3 h-3 shrink-0 mt-0.5" />
          <span>
            INR amounts are from your statement. Actual conversion rates may vary.
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
