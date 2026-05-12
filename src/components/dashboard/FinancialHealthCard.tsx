'use client';

import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScoreRing } from './ScoreRing';
import { useTransactionStore } from '@/lib/store/transactionStore';
import { useCreditCardStore } from '@/lib/store/creditCardStore';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { formatCurrency } from '@/lib/currencyFormatter';
import { TrendingUp, TrendingDown, Lightbulb, AlertTriangle } from 'lucide-react';
import { computeMonthlyFinancials } from './financialHealth';

export function FinancialHealthCard() {
  const transactions = useTransactionStore((state) => state.transactions);
  const currency = useSettingsStore((state) => state.currency);
  const getUtilization = useCreditCardStore((state) => state.getUtilization);
  const getAllUniqueCards = useCreditCardStore((state) => state.getAllUniqueCards);

  const monthlyData = useMemo(() => {
    const utilization = getUtilization();
    const hasCCData = getAllUniqueCards().length > 0;
    return computeMonthlyFinancials(transactions, utilization.aggregate, hasCCData);
  }, [transactions, getUtilization, getAllUniqueCards]);

  if (!monthlyData.hasData || !('recentSavings' in monthlyData)) {
    return null;
  }

  // Extract values with defaults for TypeScript
  const {
    recentSavings = 0,
    savingsRate = 0,
    savingsTrend = 0,
    score = 50,
    scoreLabel = "Fair",
    metrics = [],
    projectedAnnualSavings = 0,
    monthDisplay = "",
    isNegativeSavings = false,
  } = monthlyData;

  const isTrendPositive = savingsTrend > 0;
  const savingsTrendAbs = Math.abs(savingsTrend);

  return (
    <Card className="bg-gradient-to-br from-card via-card to-muted/20 border-border">
      <CardContent className="p-6">
        <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
          {/* Score Ring */}
          <div className="flex-shrink-0">
            <ScoreRing
              score={score}
              label={scoreLabel}
            />
          </div>

          {/* Details */}
          <div className="flex-1 min-w-0">
            {/* Headline */}
            <h2 className="text-xl font-bold text-foreground mb-1">
              {isNegativeSavings ? (
                <>
                  You overspent by {formatCurrency(Math.abs(recentSavings), currency, false)} in {monthDisplay}
                </>
              ) : (
                <>
                  You saved {formatCurrency(recentSavings, currency, false)} in {monthDisplay}
                </>
              )}
            </h2>

            {/* Subheadline */}
            <p className="text-muted-foreground mb-2">
              {isNegativeSavings ? (
                <>
                  Expenses exceeded income by {Math.abs(savingsRate).toFixed(0)}%
                </>
              ) : (
                <>
                  That&apos;s {savingsRate.toFixed(0)}% of your income
                </>
              )}
            </p>

            {/* Trend */}
            <div className={`flex items-center gap-2 font-medium mb-4 ${
              isTrendPositive ? 'text-success' : 'text-destructive'
            }`}>
              {isTrendPositive ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              <span>
                {isTrendPositive ? '+' : '-'}{savingsTrendAbs.toFixed(0)}% vs previous month
              </span>
            </div>

            {/* Tip */}
            <div className={`flex items-start gap-2 text-sm rounded-lg p-3 ${
              isNegativeSavings
                ? 'text-destructive-foreground bg-destructive/10'
                : 'text-muted-foreground bg-muted/30'
            }`}>
              {isNegativeSavings ? (
                <AlertTriangle className="w-4 h-4 mt-0.5 text-destructive flex-shrink-0" />
              ) : (
                <Lightbulb className="w-4 h-4 mt-0.5 text-warning flex-shrink-0" />
              )}
              <p>
                {projectedAnnualSavings < 0 ? (
                  <>
                    At this rate, you&apos;ll be down{' '}
                    <span className="font-semibold text-destructive">
                      {formatCurrency(Math.abs(projectedAnnualSavings), currency, false)}
                    </span>{' '}
                    by year end. Consider reviewing your expenses.
                  </>
                ) : (
                  <>
                    At this rate, you&apos;re on track to save{' '}
                    <span className="font-semibold text-foreground">
                      {formatCurrency(projectedAnnualSavings, currency, false)}
                    </span>{' '}
                    this year.
                  </>
                )}
              </p>
            </div>

            {/* Breakdown */}
            <div className="mt-6 pt-6 border-t border-border">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                Score Breakdown
              </h3>
              <div className="space-y-3">
                {metrics.map((metric) => (
                  <div key={metric.label} className="flex items-center gap-4">
                    <span className="w-20 text-sm text-muted-foreground">
                      {metric.label}
                    </span>
                    <Progress
                      value={metric.value}
                      className="flex-1 h-2"
                    />
                    <span className={`w-24 text-xs text-right font-medium ${
                      metric.statusType === 'good' ? 'text-success' :
                      metric.statusType === 'warning' ? 'text-warning' :
                      'text-destructive'
                    }`}>
                      {metric.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
