"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  Lightbulb,
} from "lucide-react";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";
import { DebtTrapAnalysis } from "@/types/creditCard";

/**
 * Debt Trap Warning Card
 *
 * Analyzes statement history to detect concerning patterns
 * and provides warnings and recommendations.
 */
export function DebtTrapWarningCard() {
  const getDebtTrapAnalysis = useCreditCardStore((state) => state.getDebtTrapAnalysis);
  const currency = useSettingsStore((state) => state.currency);

  const analysis = useMemo<DebtTrapAnalysis>(() => getDebtTrapAnalysis(), [getDebtTrapAnalysis]);

  if (analysis.cards.length === 0) {
    return null;
  }

  // Only show if there's some risk
  const hasRisk = analysis.overallRiskLevel !== 'none';
  const riskyCards = analysis.cards.filter((c) => c.riskLevel !== 'none');

  if (!hasRisk) {
    return (
      <Card className="border-success">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="w-4 h-4 text-success" />
            Debt Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
            <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium text-success">
                Healthy Payment Behavior
              </div>
              <div className="mt-1 text-muted-foreground">
                You&apos;re paying your cards in full each month. Keep up the good work!
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getRiskIcon = (level: DebtTrapAnalysis['overallRiskLevel']) => {
    switch (level) {
      case 'critical':
      case 'high':
        return <AlertTriangle className="w-5 h-5 text-destructive" />;
      case 'medium':
        return <AlertCircle className="w-5 h-5 text-amber-500" />;
      case 'low':
        return <Info className="w-5 h-5 text-blue-500" />;
      default:
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    }
  };

  const getRiskColor = (level: DebtTrapAnalysis['overallRiskLevel']) => {
    switch (level) {
      case 'critical':
      case 'high':
        return 'destructive';
      case 'medium':
        return 'outline';
      case 'low':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const getTrendIcon = (trend: number) => {
    if (trend > 0.05) return <TrendingUp className="w-3 h-3 text-destructive" />;
    if (trend < -0.05) return <TrendingDown className="w-3 h-3 text-green-500" />;
    return <Minus className="w-3 h-3 text-muted-foreground" />;
  };

  return (
    <Card className={analysis.overallRiskLevel === 'critical' ? 'border-destructive' : ''}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {getRiskIcon(analysis.overallRiskLevel)}
          Debt Health Analysis
          <Badge variant={getRiskColor(analysis.overallRiskLevel)} className="ml-auto">
            {analysis.overallRiskLevel.toUpperCase()} RISK
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overall summary */}
        {analysis.totalRevolvingDebt > 0 && (
          <div className="p-3 bg-muted/50 rounded-lg border border-border">
            <div className="text-sm font-medium text-warning">
              Total Revolving Debt
            </div>
            <div className="mt-1 font-mono text-2xl font-bold text-warning">
              {formatCurrency(analysis.totalRevolvingDebt, currency)}
            </div>
          </div>
        )}

        {/* Per-card analysis */}
        <div className="space-y-2">
          {riskyCards.map((card) => (
            <div
              key={`${card.cardIssuer}-${card.cardLastFour}`}
              className={`p-3 rounded-lg border ${
                card.riskLevel === 'high'
                  ? 'bg-destructive/10 border-destructive/30'
                  : card.riskLevel === 'medium'
                  ? 'bg-muted/50 border-border'
                  : 'bg-muted/30 border-border'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {card.cardIssuer} ****{card.cardLastFour}
                  </span>
                  <Badge variant={getRiskColor(card.riskLevel)} className="text-xs">
                    {card.riskLevel}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  {getTrendIcon(card.balanceTrend)}
                  {card.balanceTrend > 0 ? 'Increasing' : card.balanceTrend < 0 ? 'Decreasing' : 'Stable'}
                </div>
              </div>

              {/* Metrics */}
              <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                <div>
                  <div className="text-muted-foreground">Avg Balance</div>
                  <div className="font-mono font-medium">
                    {formatCurrency(card.averageBalance, currency)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Months Revolving</div>
                  <div className="font-mono font-medium">
                    {card.consecutiveMonthsRevolving}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Min Only</div>
                  <div className="font-mono font-medium">
                    {card.paysMinimumOnly ? 'Yes' : 'No'}
                  </div>
                </div>
              </div>

              {/* Warnings */}
              {card.warnings.length > 0 && (
                <div className="space-y-1">
                  {card.warnings.map((warning, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-1 text-xs text-warning"
                    >
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      {warning}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Recommendations */}
        {analysis.recommendations.length > 0 && (
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-2 text-sm font-medium mb-2">
              <Lightbulb className="w-4 h-4 text-primary" />
              Recommendations
            </div>
            <ul className="space-y-2">
              {analysis.recommendations.map((rec, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="text-primary font-bold">•</span>
                  {rec}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
