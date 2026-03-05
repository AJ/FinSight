"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Wallet,
  Star,
  Percent,
} from "lucide-react";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";

/**
 * Cashback Summary Card
 *
 * Shows cashback earned across all cards with per-card breakdown.
 */
export function CashbackSummaryCard() {
  const getCashbackAnalysis = useCreditCardStore((state) => state.getCashbackAnalysis);
  const currency = useSettingsStore((state) => state.currency);

  const analysis = useMemo(() => getCashbackAnalysis(), [getCashbackAnalysis]);

  const hasCashback = analysis.totalCashbackAllCards > 0 || analysis.byCard.some(c => c.totalCashback > 0);
  const formatPercent = (rate: number) => `${(rate * 100).toFixed(2)}%`;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="w-4 h-4 text-success" />
          Cashback Earned
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasCashback ? (
          <>
            {/* Total */}
            <div className="p-3 bg-muted/50 rounded-lg border border-border">
              <div className="text-sm text-muted-foreground">Total Cashback</div>
              <div className="font-mono text-2xl font-bold text-success">
                {formatCurrency(analysis.totalCashbackAllCards, currency)}
              </div>
            </div>

            {/* Best card */}
            {analysis.bestCard && (
              <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg">
                <Star className="w-4 h-4 text-warning" />
                <span className="text-sm">
                  Best rate: <strong>{analysis.bestCard.issuer} ****{analysis.bestCard.lastFour}</strong> at {formatPercent(analysis.bestCard.rate)}
                </span>
              </div>
            )}

            {/* Per-card breakdown */}
            <div className="space-y-2">
              {analysis.byCard
                .filter((c) => c.totalCashback > 0)
                .sort((a, b) => b.totalCashback - a.totalCashback)
                .map((card) => (
                  <div
                    key={`${card.cardIssuer}-${card.cardLastFour}`}
                    className="flex items-center justify-between p-2 bg-muted/30 rounded-lg"
                  >
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">
                        {card.cardIssuer} ****{card.cardLastFour}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Percent className="w-3 h-3" />
                        {formatPercent(card.averageCashbackRate)} rate
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm font-semibold text-success">
                        {formatCurrency(card.totalCashback, currency)}
                      </div>
                      {card.cashbackByPeriod.length > 1 && (
                        <div className="text-xs text-muted-foreground">
                          {card.cashbackByPeriod.length} periods
                        </div>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Wallet className="w-10 h-10 text-muted-foreground mb-3" />
            <div className="text-sm font-medium">No Cashback Data</div>
            <div className="text-xs text-muted-foreground mt-1 max-w-[250px]">
              Cashback will appear here when detected in your credit card statements.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
