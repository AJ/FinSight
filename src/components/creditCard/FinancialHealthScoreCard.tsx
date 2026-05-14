"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Activity, TrendingUp, TrendingDown, Percent, Clock, Wallet } from "lucide-react";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { FinancialHealthScore } from "@/types/creditCard";
import {
  getHealthScoreColor,
  getHealthScoreLabel,
  getHealthBadgeVariant,
} from "@/lib/creditCard/creditCardClassification";

interface FinancialHealthScoreCardProps {
  /** Compact mode hides component breakdown */
  compact?: boolean;
}

/**
 * Financial Health Score Card
 *
 * Displays an overall financial health score based on:
 * - Credit utilization (40% weight)
 * - Full payment rate (35% weight)
 * - On-time payment rate (15% weight)
 * - Spending trend (10% weight)
 *
 * In compact mode, shows a simplified KPI-style card.
 */
export function FinancialHealthScoreCard({ compact = false }: FinancialHealthScoreCardProps) {
  const transactions = useTransactionStore((state) => state.transactions);
  const getFinancialHealthScore = useCreditCardStore((state) => state.getFinancialHealthScore);
  const getTotalIncome = useTransactionStore((state) => state.getTotalIncome);
  const getTotalExpenses = useTransactionStore((state) => state.getTotalExpenses);
  const getAllUniqueCards = useCreditCardStore((state) => state.getAllUniqueCards);

  const hasCCData = getAllUniqueCards().length > 0;

  const healthScore: FinancialHealthScore | null = useMemo(() => {
    if (!hasCCData) return null;

    const income = getTotalIncome();
    const expenses = getTotalExpenses();
    return getFinancialHealthScore(transactions, income, expenses);
  }, [hasCCData, getFinancialHealthScore, transactions, getTotalIncome, getTotalExpenses]);

  // Don't show if no CC data
  if (!hasCCData || !healthScore) {
    return null;
  }

  const { score, components } = healthScore;
  const scoreColor = getHealthScoreColor(score);
  const scoreLabel = getHealthScoreLabel(score);

  // Check for partial data indicator
  const hasBankData = transactions.some((t) => t.sourceType !== "credit_card");
  const partialInfo = !hasBankData ? "no bank stmt" : undefined;

  // Compact mode: Simple KPI card
  if (compact) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Health Score
          </div>
          <div className="text-2xl font-bold mt-1.5">
            <span className={scoreColor}>{score}</span>
            <span className="text-sm text-muted-foreground font-normal">/100</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge variant={getHealthBadgeVariant(score)}>{scoreLabel}</Badge>
            {partialInfo && (
              <span className="text-xs text-muted-foreground">{partialInfo}</span>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="w-4 h-4 text-primary" />
          Financial Health Score
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main Score */}
        <div className="text-center py-2">
          <div className={`text-4xl font-bold ${scoreColor}`}>{score}</div>
          <div className="text-sm text-muted-foreground">{scoreLabel}</div>
          <Progress value={score} className="h-2 mt-2" />
        </div>

        <Separator />

        {/* Score Components */}
        <div className="space-y-3">
          {/* Utilization */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Percent className="w-3 h-3 text-muted-foreground" />
              <span>Credit Utilization</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${getHealthScoreColor(components.utilization.score)}`}>
                {Math.round(components.utilization.value * 100)}%
              </span>
              <span className="text-xs text-muted-foreground w-8">
                {components.utilization.score}pts
              </span>
            </div>
          </div>

          {/* Full Pay Rate */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <TrendingUp className="w-3 h-3 text-muted-foreground" />
              <span>Full Payment Rate</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${getHealthScoreColor(components.fullPayRate.score)}`}>
                {Math.round(components.fullPayRate.value * 100)}%
              </span>
              <span className="text-xs text-muted-foreground w-8">
                {components.fullPayRate.score}pts
              </span>
            </div>
          </div>

          {/* On-time Rate */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <span>On-time Payment</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${getHealthScoreColor(components.onTimeRate.score)}`}>
                {Math.round(components.onTimeRate.value * 100)}%
              </span>
              <span className="text-xs text-muted-foreground w-8">
                {components.onTimeRate.score}pts
              </span>
            </div>
          </div>

          {/* Spending Trend */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Wallet className="w-3 h-3 text-muted-foreground" />
              <span>Spending vs Income</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${getHealthScoreColor(components.spendingTrend.score)}`}>
                {components.spendingTrend.value < 1 ? (
                  <span className="flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    Under budget
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <TrendingDown className="w-3 h-3" />
                    Over budget
                  </span>
                )}
              </span>
              <span className="text-xs text-muted-foreground w-8">
                {components.spendingTrend.score}pts
              </span>
            </div>
          </div>
        </div>

        {/* Weights Info */}
        <p className="text-xs text-muted-foreground pt-2 border-t">
          Weights: Utilization 40% • Full Pay 35% • On-time 15% • Spending 10%
        </p>
      </CardContent>
    </Card>
  );
}
