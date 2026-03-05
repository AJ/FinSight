"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Calculator,
  TrendingDown,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";
import { InterestProjection } from "@/types/creditCard";
import { Currency } from "@/types";
import { formatPayoffTime } from "@/lib/creditCard/interestCalculator";

/**
 * Interest Calculator Card
 *
 * Shows interest projections for each card with different payment scenarios.
 * Helps users understand the true cost of minimum payments.
 */
export function InterestCalculatorCard() {
  const getInterestProjections = useCreditCardStore((state) => state.getInterestProjections);
  const currency = useSettingsStore((state) => state.currency);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  const projections = useMemo(() => getInterestProjections(), [getInterestProjections]);

  if (projections.length === 0) {
    return null;
  }

  // Filter to only show cards with balance
  const debtProjections = projections.filter((p) => p.currentBalance > 0);

  if (debtProjections.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="w-4 h-4 text-primary" />
            Interest Calculator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-green-600">
            <TrendingDown className="w-4 h-4" />
            All cards are paid off. No interest calculations needed.
          </div>
        </CardContent>
      </Card>
    );
  }

  const toggleExpanded = (cardKey: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(cardKey)) {
        next.delete(cardKey);
      } else {
        next.add(cardKey);
      }
      return next;
    });
  };

  // Calculate totals
  const totalBalance = debtProjections.reduce((sum, p) => sum + p.currentBalance, 0);
  const totalInterest = debtProjections.reduce((sum, p) => sum + p.minimumPayoff.totalInterest, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="w-4 h-4 text-primary" />
          Interest Calculator
          <Badge variant="outline" className="ml-auto text-xs">
            {debtProjections.length} card{debtProjections.length > 1 ? "s" : ""} with balance
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="p-3 bg-muted/50 rounded-lg border border-border">
          <div className="flex items-center gap-2 text-sm font-medium text-warning">
            <AlertCircle className="w-4 h-4" />
            Paying Only Minimum
          </div>
          <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Total Interest Cost</div>
              <div className="font-mono text-lg font-bold text-warning">
                {formatCurrency(totalInterest, currency)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Total to Pay</div>
              <div className="font-mono text-lg font-bold">
                {formatCurrency(totalBalance + totalInterest, currency)}
              </div>
            </div>
          </div>
        </div>

        {/* Per-card projections */}
        <div className="space-y-2">
          {debtProjections.map((projection) => (
            <CardProjection
              key={`${projection.cardIssuer}-${projection.cardLastFour}`}
              projection={projection}
              currency={currency}
              isExpanded={expandedCards.has(`${projection.cardIssuer}-${projection.cardLastFour}`)}
              onToggle={() => toggleExpanded(`${projection.cardIssuer}-${projection.cardLastFour}`)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface CardProjectionProps {
  projection: InterestProjection;
  currency: Currency;
  isExpanded: boolean;
  onToggle: () => void;
}

function CardProjection({ projection, currency, isExpanded, onToggle }: CardProjectionProps) {
  const [selectedPayment, setSelectedPayment] = useState(projection.minimumDue);

  const formatAPR = (apr: number) => `${(apr * 100).toFixed(1)}% APR`;

  // Find matching scenario for current slider value
  const currentScenario = projection.fixedPaymentScenarios.find(
    (s) => s.monthlyPayment >= selectedPayment
  );

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {projection.cardIssuer} ****{projection.cardLastFour}
          </span>
          <Badge variant="outline" className="text-xs">
            {formatAPR(projection.apr)}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="font-mono text-sm font-semibold">
              {formatCurrency(projection.currentBalance, currency)}
            </div>
            <div className="text-xs text-muted-foreground">
              Min: {formatCurrency(projection.minimumDue, currency)}/mo
            </div>
          </div>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Details */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* Minimum payment warning */}
          <div className="flex items-start gap-3 p-3 bg-destructive/5 rounded-lg border border-destructive/20">
            <Clock className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium text-destructive">If you pay only minimum:</div>
              <div className="mt-1 space-y-1 text-muted-foreground">
                <div>
                  Time to payoff: <strong>{formatPayoffTime(projection.minimumPayoff.monthsToPayoff)}</strong>
                </div>
                <div>
                  Total interest: <strong>{formatCurrency(projection.minimumPayoff.totalInterest, currency)}</strong>
                </div>
                <div>
                  Total paid: <strong>{formatCurrency(projection.minimumPayoff.totalPaid, currency)}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Payment slider */}
          <div className="space-y-2">
            <label className="text-sm font-medium">What if you pay more?</label>
            <Slider
              value={[selectedPayment]}
              onValueChange={([value]) => setSelectedPayment(value)}
              min={projection.minimumDue}
              max={projection.currentBalance}
              step={100}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Min: {formatCurrency(projection.minimumDue, currency)}</span>
              <span className="font-medium text-foreground">
                {formatCurrency(selectedPayment, currency)}/mo
              </span>
              <span>Full: {formatCurrency(projection.currentBalance, currency)}</span>
            </div>
          </div>

          {/* Scenario result */}
          {currentScenario && selectedPayment > projection.minimumDue && (
            <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-300">
                <TrendingDown className="w-4 h-4" />
                With {formatCurrency(selectedPayment, currency)}/month:
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <div className="text-muted-foreground text-xs">Payoff Time</div>
                  <div className="font-mono font-semibold text-green-700 dark:text-green-300">
                    {formatPayoffTime(currentScenario.monthsToPayoff)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Interest</div>
                  <div className="font-mono font-semibold text-green-700 dark:text-green-300">
                    {formatCurrency(currentScenario.totalInterest, currency)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">You Save</div>
                  <div className="font-mono font-semibold text-green-700 dark:text-green-300">
                    {formatCurrency(
                      projection.minimumPayoff.totalInterest - currentScenario.totalInterest,
                      currency
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
