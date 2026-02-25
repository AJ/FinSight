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

interface HealthMetric {
  label: string;
  value: number;
  max: number;
  status: string;
  statusType: 'good' | 'warning' | 'bad';
}

export function FinancialHealthCard() {
  const transactions = useTransactionStore((state) => state.transactions);
  const currency = useSettingsStore((state) => state.currency);
  const getUtilization = useCreditCardStore((state) => state.getUtilization);
  const getAllUniqueCards = useCreditCardStore((state) => state.getAllUniqueCards);

  // Calculate recent month's data
  const monthlyData = useMemo(() => {
    if (transactions.length === 0) {
      return { hasData: false };
    }

    // Get year-month key (e.g., "2025-02")
    const getYearMonth = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    // Group transactions by month
    const byMonth = new Map<string, typeof transactions>();
    for (const t of transactions) {
      const date = t.date instanceof Date ? t.date : new Date(t.date);
      if (isNaN(date.getTime())) continue;
      const key = getYearMonth(date);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(t);
    }

    // Get sorted months (most recent first)
    const sortedMonths = Array.from(byMonth.keys()).sort((a, b) => b.localeCompare(a));

    if (sortedMonths.length === 0) {
      return { hasData: false };
    }

    // Get recent month and previous month
    const recentMonthKey = sortedMonths[0];
    const prevMonthKey = sortedMonths.length > 1 ? sortedMonths[1] : null;

    const recentTxns = byMonth.get(recentMonthKey) || [];
    const prevTxns = prevMonthKey ? byMonth.get(prevMonthKey) || [] : [];

    // Calculate income and expenses for recent month
    const recentIncome = recentTxns
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);

    const recentExpenses = recentTxns
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    // Calculate income and expenses for previous month
    const prevIncome = prevTxns
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);

    const prevExpenses = prevTxns
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const recentSavings = recentIncome - recentExpenses;
    const prevSavings = prevIncome - prevExpenses;
    const isNegativeSavings = recentSavings < 0;

    // Calculate trend
    const savingsTrend = prevSavings !== 0
      ? ((recentSavings - prevSavings) / Math.abs(prevSavings)) * 100
      : recentSavings !== 0 ? (recentSavings > 0 ? 100 : -100) : 0;

    // Savings rate (can be negative)
    const savingsRate = recentIncome > 0
      ? (recentSavings / recentIncome) * 100
      : recentSavings < 0 ? -100 : 0;

    // Credit utilization from CC data
    const utilization = getUtilization();
    const totalUtilization = utilization.aggregate * 100; // Convert to percentage

    // Calculate health score
    let score = 50; // Base score

    // Savings rate contribution (up to 30 points, down to -20 points)
    if (savingsRate >= 30) score += 30;
    else if (savingsRate >= 20) score += 25;
    else if (savingsRate >= 10) score += 15;
    else if (savingsRate >= 0) score += 5;
    else if (savingsRate >= -10) score -= 5;
    else if (savingsRate >= -25) score -= 15;
    else score -= 25;

    // Utilization contribution (up to 20 points)
    const hasCCData = getAllUniqueCards().length > 0;
    if (!hasCCData) score += 10; // No CC data, neutral
    else if (totalUtilization <= 30) score += 20;
    else if (totalUtilization <= 50) score += 10;
    else if (totalUtilization <= 70) score += 0;
    else score -= 10;

    // Clamp score
    score = Math.max(0, Math.min(100, score));

    // Get label for score
    const getScoreLabel = (score: number) => {
      if (score >= 80) return 'Excellent';
      if (score >= 60) return 'Good';
      if (score >= 40) return 'Fair';
      return 'Needs Work';
    };

    // Health metrics
    const metrics: HealthMetric[] = [
      {
        label: 'Utilization',
        value: totalUtilization,
        max: 100,
        status: !hasCCData ? 'N/A' : totalUtilization <= 30 ? 'Good' : totalUtilization <= 50 ? 'OK' : 'High',
        statusType: !hasCCData ? 'good' : totalUtilization <= 30 ? 'good' : totalUtilization <= 50 ? 'warning' : 'bad',
      },
      {
        label: 'Savings',
        value: Math.max(0, savingsRate), // Progress bar can't show negative
        max: 100,
        status: savingsRate >= 20 ? 'Excellent' : savingsRate >= 10 ? 'Good' : savingsRate >= 0 ? 'Low' : 'Overspent',
        statusType: savingsRate >= 20 ? 'good' : savingsRate >= 10 ? 'warning' : 'bad',
      },
      {
        label: 'Bills',
        value: 100, // We don't track bill payments yet
        max: 100,
        status: 'On-time',
        statusType: 'good',
      },
    ];

    // Projected annual savings (can be negative)
    const projectedAnnualSavings = recentSavings * 12;

    // Format month for display
    const [year, month] = recentMonthKey.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthDisplay = `${monthNames[parseInt(month) - 1]} ${year}`;

    return {
      recentIncome,
      recentExpenses,
      recentSavings,
      savingsRate,
      savingsTrend,
      score,
      scoreLabel: getScoreLabel(score),
      metrics,
      projectedAnnualSavings,
      monthDisplay,
      isNegativeSavings,
      hasData: true,
    };
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
