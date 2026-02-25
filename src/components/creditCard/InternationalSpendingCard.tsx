"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe, MapPin, DollarSign } from "lucide-react";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";

interface CurrencyTotal {
  currency: string;
  originalAmount: number;
  inrAmount: number;
  transactionCount: number;
}

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

  const internationalData = useMemo(() => {
    // Filter transactions with foreign currency
    const intlTxns = transactions.filter(
      (t) => t.currency && t.currency !== "INR" && t.sourceType === "credit_card"
    );

    if (intlTxns.length === 0) return null;

    // Group by currency
    const currencyMap = new Map<string, CurrencyTotal>();

    for (const txn of intlTxns) {
      const curr = txn.currency!;
      const existing = currencyMap.get(curr);

      if (existing) {
        existing.originalAmount += txn.originalAmount || Math.abs(txn.amount);
        existing.inrAmount += Math.abs(txn.amount);
        existing.transactionCount++;
      } else {
        currencyMap.set(curr, {
          currency: curr,
          originalAmount: txn.originalAmount || Math.abs(txn.amount),
          inrAmount: Math.abs(txn.amount),
          transactionCount: 1,
        });
      }
    }

    // Convert to array and sort by INR amount
    const currencies = Array.from(currencyMap.values()).sort(
      (a, b) => b.inrAmount - a.inrAmount
    );

    // Calculate totals
    const totalInr = currencies.reduce((sum, c) => sum + c.inrAmount, 0);
    const totalTxns = intlTxns.length;

    return { currencies, totalInr, totalTxns };
  }, [transactions]);

  // Don't show if no international transactions
  if (!internationalData || internationalData.currencies.length === 0) {
    return null;
  }

  const { currencies, totalInr, totalTxns } = internationalData;

  // Currency symbols map
  const getCurrencySymbol = (code: string): string => {
    const symbols: Record<string, string> = {
      USD: "$",
      EUR: "€",
      GBP: "£",
      JPY: "¥",
      SGD: "S$",
      AED: "د.إ",
      AUD: "A$",
      CAD: "C$",
      CHF: "Fr",
    };
    return symbols[code] || code;
  };

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
