"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Gift,
  Wallet,
  AlertTriangle,
  TrendingUp,
  Clock,
  Sparkles,
} from "lucide-react";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";
import { format } from "date-fns";

/**
 * Rewards Summary Card
 *
 * Consolidated view of cashback and reward points across all cards.
 * Only shows when there's data to display.
 */
export function RewardsSummaryCard() {
  const getCashbackAnalysis = useCreditCardStore((state) => state.getCashbackAnalysis);
  const getRewardPointsAnalysis = useCreditCardStore((state) => state.getRewardPointsAnalysis);
  const currency = useSettingsStore((state) => state.currency);

  const cashback = useMemo(() => getCashbackAnalysis(), [getCashbackAnalysis]);
  const points = useMemo(() => getRewardPointsAnalysis(), [getRewardPointsAnalysis]);

  const hasCashback = cashback.totalCashbackAllCards > 0 || cashback.byCard.some(c => c.totalCashback > 0);
  const hasPoints = points.totalPointsAllCards > 0 || points.byCard.some(c => c.currentBalance > 0);
  const hasExpiringSoon = points.expiringSoon.length > 0;

  // Don't render if no rewards data at all
  if (!hasCashback && !hasPoints) {
    return null;
  }

  const formatPoints = (pts: number) => {
    if (pts >= 1000000) return `${(pts / 1000000).toFixed(1)}M`;
    if (pts >= 1000) return `${(pts / 1000).toFixed(1)}K`;
    return pts.toLocaleString();
  };

  const formatPercent = (rate: number) => `${(rate * 100).toFixed(2)}%`;

  // Calculate total value (cashback + estimated points value)
  const totalValue = cashback.totalCashbackAllCards + points.estimatedTotalValue;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="w-4 h-4 text-amber-500" />
          Rewards & Benefits
          {hasExpiringSoon && (
            <Badge variant="destructive" className="ml-auto text-xs">
              <AlertTriangle className="w-3 h-3 mr-1" />
              {points.expiringSoon.length} expiring
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Total Value Highlight */}
        {totalValue > 0 && (
          <div className="p-4 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 rounded-xl border border-amber-200 dark:border-amber-800/50">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Total Value</div>
                <div className="font-mono text-2xl font-bold text-amber-700 dark:text-amber-400">
                  {formatCurrency(totalValue, currency)}
                </div>
              </div>
              <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
                <Gift className="w-6 h-6 text-amber-600 dark:text-amber-400" />
              </div>
            </div>
          </div>
        )}

        {/* Cashback Section */}
        {hasCashback && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Wallet className="w-4 h-4 text-green-500" />
              Cashback Earned
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-green-50/50 dark:bg-green-950/20 rounded-lg border border-green-100 dark:border-green-900/50">
                <div className="text-xs text-muted-foreground">Total</div>
                <div className="font-mono text-lg font-semibold text-green-600 dark:text-green-400">
                  {formatCurrency(cashback.totalCashbackAllCards, currency)}
                </div>
              </div>
              {cashback.bestCard && (
                <div className="p-3 bg-muted/30 rounded-lg">
                  <div className="text-xs text-muted-foreground">Best Rate</div>
                  <div className="text-sm font-medium truncate">
                    {cashback.bestCard.issuer} ****{cashback.bestCard.lastFour}
                  </div>
                  <div className="text-xs text-green-600 dark:text-green-400">
                    {formatPercent(cashback.bestCard.rate)}
                  </div>
                </div>
              )}
            </div>

            {/* Cashback by card */}
            {cashback.byCard.filter(c => c.totalCashback > 0).length > 1 && (
              <div className="space-y-1.5">
                {cashback.byCard
                  .filter(c => c.totalCashback > 0)
                  .sort((a, b) => b.totalCashback - a.totalCashback)
                  .map(card => (
                    <div
                      key={`${card.cardIssuer}-${card.cardLastFour}`}
                      className="flex items-center justify-between py-1.5 px-2 rounded bg-muted/20 text-sm"
                    >
                      <span className="text-muted-foreground">
                        {card.cardIssuer} ****{card.cardLastFour}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {formatPercent(card.averageCashbackRate)}
                        </span>
                        <span className="font-mono font-medium text-green-600 dark:text-green-400">
                          {formatCurrency(card.totalCashback, currency)}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Points Section */}
        {hasPoints && (
          <div className={`space-y-3 ${hasCashback ? 'pt-3 border-t' : ''}`}>
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Gift className="w-4 h-4 text-purple-500" />
              Reward Points
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-purple-50/50 dark:bg-purple-950/20 rounded-lg border border-purple-100 dark:border-purple-900/50">
                <div className="text-xs text-muted-foreground">Total Points</div>
                <div className="font-mono text-lg font-semibold text-purple-600 dark:text-purple-400">
                  {formatPoints(points.totalPointsAllCards)}
                </div>
              </div>
              <div className="p-3 bg-muted/30 rounded-lg">
                <div className="text-xs text-muted-foreground">Est. Value</div>
                <div className="font-mono text-lg font-semibold text-purple-600 dark:text-purple-400">
                  {formatCurrency(points.estimatedTotalValue, currency)}
                </div>
              </div>
            </div>

            {/* Expiring soon alerts */}
            {hasExpiringSoon && (
              <div className="p-3 bg-red-50/50 dark:bg-red-950/20 rounded-lg border border-red-100 dark:border-red-900/50">
                <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-300 mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  Expiring Soon
                </div>
                <div className="space-y-1.5">
                  {points.expiringSoon.slice(0, 3).map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-muted-foreground">
                        {item.cardIssuer} ****{item.cardLastFour}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-red-600 dark:text-red-400">
                          {formatPoints(item.points)}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {format(item.expiryDate, "MMM dd")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Points by card */}
            {points.byCard.filter(c => c.currentBalance > 0).length > 1 && (
              <div className="space-y-1.5">
                {points.byCard
                  .filter(c => c.currentBalance > 0)
                  .sort((a, b) => b.currentBalance - a.currentBalance)
                  .map(card => (
                    <div
                      key={`${card.cardIssuer}-${card.cardLastFour}`}
                      className="flex items-center justify-between py-1.5 px-2 rounded bg-muted/20 text-sm"
                    >
                      <span className="text-muted-foreground">
                        {card.cardIssuer} ****{card.cardLastFour}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <TrendingUp className="w-3 h-3 text-green-500" />
                          +{formatPoints(card.totalEarned)}
                        </span>
                        <span className="font-mono font-medium text-purple-600 dark:text-purple-400">
                          {formatPoints(card.currentBalance)}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
