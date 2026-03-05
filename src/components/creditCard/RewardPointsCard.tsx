"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Gift,
  Star,
  AlertTriangle,
  TrendingUp,
  Clock,
} from "lucide-react";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";
import { format } from "date-fns";

/**
 * Reward Points Card
 *
 * Shows reward points balance and activity across all cards.
 * Highlights points expiring soon.
 */
export function RewardPointsCard() {
  const getRewardPointsAnalysis = useCreditCardStore((state) => state.getRewardPointsAnalysis);
  const currency = useSettingsStore((state) => state.currency);

  const analysis = useMemo(() => getRewardPointsAnalysis(), [getRewardPointsAnalysis]);

  const hasPoints = analysis.totalPointsAllCards > 0 || analysis.byCard.some(c => c.currentBalance > 0);
  const hasExpiringSoon = analysis.expiringSoon.length > 0;

  const formatPoints = (points: number) => {
    if (points >= 1000000) {
      return `${(points / 1000000).toFixed(1)}M`;
    }
    if (points >= 1000) {
      return `${(points / 1000).toFixed(1)}K`;
    }
    return points.toLocaleString();
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gift className="w-4 h-4 text-primary" />
          Reward Points
          {hasExpiringSoon && (
            <Badge variant="destructive" className="ml-auto text-xs">
              <AlertTriangle className="w-3 h-3 mr-1" />
              {analysis.expiringSoon.length} expiring
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasPoints ? (
          <>
            {/* Total points and value */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-muted/50 rounded-lg border border-border">
                <div className="text-xs text-muted-foreground">Total Points</div>
                <div className="font-mono text-xl font-bold text-primary">
                  {formatPoints(analysis.totalPointsAllCards)}
                </div>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg border border-border">
                <div className="text-xs text-muted-foreground">Est. Value</div>
                <div className="font-mono text-xl font-bold text-success">
                  {formatCurrency(analysis.estimatedTotalValue, currency)}
                </div>
              </div>
            </div>

            {/* Expiring soon alerts */}
            {hasExpiringSoon && (
              <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/30">
                <div className="flex items-center gap-2 text-sm font-medium text-destructive mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  Points Expiring Soon
                </div>
                <div className="space-y-2">
                  {analysis.expiringSoon.slice(0, 3).map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-sm"
                    >
                      <div className="text-muted-foreground">
                        {item.cardIssuer} ****{item.cardLastFour}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-destructive">
                          {formatPoints(item.points)} pts
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

            {/* Per-card breakdown */}
            <div className="space-y-2">
              {analysis.byCard
                .filter((c) => c.currentBalance > 0 || c.totalEarned > 0)
                .sort((a, b) => b.currentBalance - a.currentBalance)
                .map((card) => (
                  <div
                    key={`${card.cardIssuer}-${card.cardLastFour}`}
                    className="p-3 bg-muted/30 rounded-lg"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium">
                        {card.cardIssuer} ****{card.cardLastFour}
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm font-bold text-primary">
                          {formatPoints(card.currentBalance)} pts
                        </div>
                        <div className="text-xs text-muted-foreground">
                          ≈ {formatCurrency(card.estimatedValue, currency)}
                        </div>
                      </div>
                    </div>

                    {/* Activity summary */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3 text-success" />
                        <span>+{formatPoints(card.totalEarned)} earned</span>
                      </div>
                      {card.totalRedeemed > 0 && (
                        <div className="flex items-center gap-1">
                          <Gift className="w-3 h-3 text-primary" />
                          <span>-{formatPoints(card.totalRedeemed)} redeemed</span>
                        </div>
                      )}
                      {card.totalExpired > 0 && (
                        <div className="flex items-center gap-1 text-destructive">
                          <AlertTriangle className="w-3 h-3" />
                          <span>-{formatPoints(card.totalExpired)} expired</span>
                        </div>
                      )}
                    </div>

                    {/* Earning rate */}
                    {card.earningRate > 0 && (
                      <div className="mt-2 flex items-center gap-1 text-xs">
                        <Star className="w-3 h-3 text-warning" />
                        <span className="text-muted-foreground">
                          {card.earningRate.toFixed(1)} pts per ₹100 spent
                        </span>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Gift className="w-10 h-10 text-muted-foreground mb-3" />
            <div className="text-sm font-medium">No Reward Points Data</div>
            <div className="text-xs text-muted-foreground mt-1 max-w-[250px]">
              Reward points will appear here when detected in your credit card statements.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
