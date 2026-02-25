"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Percent, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";

/**
 * Credit Utilization Card
 *
 * Shows credit utilization ratio - a key factor in credit scores.
 * Under 30% is considered good, under 10% is excellent.
 */
export function CreditUtilizationCard() {
  const getUtilization = useCreditCardStore((state) => state.getUtilization);
  const getAllUniqueCards = useCreditCardStore((state) => state.getAllUniqueCards);
  const currency = useSettingsStore((state) => state.currency);

  const utilization = useMemo(() => getUtilization(), [getUtilization]);
  const uniqueCards = useMemo(() => getAllUniqueCards(), [getAllUniqueCards]);

  // Don't show if no CC data
  if (uniqueCards.length === 0) {
    return null;
  }

  const aggregatePercent = Math.round(utilization.aggregate * 100);

  // Determine utilization status
  const getStatus = (util: number): {
    label: string;
    color: string;
    textColor: string;
    icon: React.ReactNode;
  } => {
    if (util < 0.10) {
      return {
        label: "Excellent",
        color: "bg-success",
        textColor: "text-success",
        icon: <CheckCircle2 className="w-4 h-4" />,
      };
    } else if (util < 0.30) {
      return {
        label: "Good",
        color: "bg-blue-500",
        textColor: "text-blue-500",
        icon: <CheckCircle2 className="w-4 h-4" />,
      };
    } else if (util < 0.50) {
      return {
        label: "Fair",
        color: "bg-amber-500",
        textColor: "text-amber-500",
        icon: <AlertTriangle className="w-4 h-4" />,
      };
    } else {
      return {
        label: "High",
        color: "bg-destructive",
        textColor: "text-destructive",
        icon: <AlertTriangle className="w-4 h-4" />,
      };
    }
  };

  const status = getStatus(utilization.aggregate);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Percent className="w-4 h-4 text-primary" />
          Credit Utilization
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Aggregate utilization */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Overall</span>
            <div className={`flex items-center gap-1 ${status.textColor}`}>
              {status.icon}
              <span className="text-sm font-medium">{status.label}</span>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>{aggregatePercent}%</span>
              <span className="text-muted-foreground">
                {formatCurrency(utilization.totalDue, currency)} / {formatCurrency(utilization.totalLimit, currency)}
              </span>
            </div>
            <Progress value={aggregatePercent} className="h-2" />
          </div>
        </div>

        {/* Per-card breakdown */}
        {uniqueCards.length > 1 && (
          <div className="space-y-2 pt-2 border-t">
            <p className="text-xs text-muted-foreground font-medium">Per Card</p>
            {uniqueCards.map((card) => {
              const key = `${card.cardIssuer}-${card.cardLastFour}`;
              const cardUtil = utilization.perCard.get(key);
              if (!cardUtil) return null;

              const cardStatus = getStatus(cardUtil.utilization);
              const cardPercent = Math.round(cardUtil.utilization * 100);

              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate">
                      {card.cardIssuer} ****{card.cardLastFour}
                    </span>
                    <span className={cardStatus.textColor}>{cardPercent}%</span>
                  </div>
                  <Progress value={cardPercent} className="h-1.5" />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
