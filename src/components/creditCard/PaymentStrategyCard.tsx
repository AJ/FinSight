"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Target,
  TrendingDown,
  ArrowUpRight,
  Calculator,
  Sparkles,
  Calendar,
} from "lucide-react";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";
import { PaymentStrategy, PaymentRecommendation } from "@/types/creditCard";
import { compareStrategies } from "@/lib/creditCard/paymentStrategy";
import { format } from "date-fns";

/**
 * Payment Strategy Card
 *
 * Recommends how to allocate payments across multiple cards.
 * Supports Avalanche (highest APR first) and Snowball (lowest balance first) methods.
 */
export function PaymentStrategyCard() {
  const getAllUniqueCards = useCreditCardStore((state) => state.getAllUniqueCards);
  const getMostRecentStatement = useCreditCardStore((state) => state.getMostRecentStatement);
  const getPaymentRecommendations = useCreditCardStore((state) => state.getPaymentRecommendations);
  const currency = useSettingsStore((state) => state.currency);

  const [availableAmount, setAvailableAmount] = useState<number>(0);
  const [strategy, setStrategy] = useState<PaymentStrategy>('avalanche');
  const [inputValue, setInputValue] = useState('');

  const uniqueCards = useMemo(() => getAllUniqueCards(), [getAllUniqueCards]);

  // Check if there are cards with debt
  const cardsWithDebt = useMemo(() => {
    return uniqueCards.filter((card) => {
      const recent = getMostRecentStatement(card.cardIssuer, card.cardLastFour);
      return recent && recent.totalDue > 0;
    });
  }, [uniqueCards, getMostRecentStatement]);

  // Calculate recommendations when amount changes
  const recommendation = useMemo<PaymentRecommendation | null>(() => {
    if (availableAmount <= 0 || cardsWithDebt.length === 0) return null;
    return getPaymentRecommendations(availableAmount, strategy);
  }, [availableAmount, strategy, cardsWithDebt.length, getPaymentRecommendations]);

  // Compare both strategies
  const strategyComparison = useMemo(() => {
    if (availableAmount <= 0 || cardsWithDebt.length < 2) return null;

    const cardsData = cardsWithDebt.map((card) => {
      const recent = getMostRecentStatement(card.cardIssuer, card.cardLastFour)!;
      return {
        issuer: card.cardIssuer,
        lastFour: card.cardLastFour,
        balance: recent.totalDue,
        apr: recent.apr ?? 0.408,
      };
    });

    return compareStrategies(cardsData, availableAmount);
  }, [availableAmount, cardsWithDebt, getMostRecentStatement]);

  const handleAmountChange = (value: string) => {
    setInputValue(value);
    const num = parseFloat(value.replace(/[^0-9.]/g, ''));
    setAvailableAmount(isNaN(num) ? 0 : num);
  };

  if (cardsWithDebt.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="w-4 h-4 text-primary" />
            Payment Strategy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-green-600">
            <TrendingDown className="w-4 h-4" />
            All cards are paid off. No payment strategy needed.
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalDebt = cardsWithDebt.reduce((sum, card) => {
    const recent = getMostRecentStatement(card.cardIssuer, card.cardLastFour);
    return sum + (recent?.totalDue ?? 0);
  }, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="w-4 h-4 text-primary" />
          Payment Strategy
          <Badge variant="outline" className="ml-auto text-xs">
            {cardsWithDebt.length} card{cardsWithDebt.length > 1 ? 's' : ''} • {formatCurrency(totalDebt, currency)} total
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Input section */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="payment-amount">Amount Available for Payment</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {currency.symbol}
              </span>
              <Input
                id="payment-amount"
                type="text"
                placeholder="Enter amount"
                value={inputValue}
                onChange={(e) => handleAmountChange(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Strategy</Label>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={strategy === 'avalanche' ? 'default' : 'outline'}
                onClick={() => setStrategy('avalanche')}
                className="text-xs"
              >
                <TrendingDown className="w-3 h-3 mr-1" />
                Avalanche
              </Button>
              <Button
                size="sm"
                variant={strategy === 'snowball' ? 'default' : 'outline'}
                onClick={() => setStrategy('snowball')}
                className="text-xs"
              >
                <Sparkles className="w-3 h-3 mr-1" />
                Snowball
              </Button>
            </div>
          </div>
        </div>

        {/* Strategy explanation */}
        <div className="p-3 bg-muted/30 rounded-lg text-sm">
          {strategy === 'avalanche' ? (
            <>
              <strong>Avalanche:</strong> Pay minimum on all cards, then put extra toward the
              highest APR card. This minimizes total interest paid.
            </>
          ) : (
            <>
              <strong>Snowball:</strong> Pay minimum on all cards, then put extra toward the
              lowest balance card. This provides quick psychological wins.
            </>
          )}
        </div>

        {/* Comparison info */}
        {strategyComparison && strategyComparison.savingsDifference > 0 && (
          <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-300">
              <Calculator className="w-4 h-4" />
              Strategy Comparison
            </div>
            <div className="mt-2 text-sm text-blue-600 dark:text-blue-400">
              {strategy === 'avalanche' ? (
                <>
                  Avalanche saves <strong>{formatCurrency(strategyComparison.savingsDifference, currency)}</strong> more than Snowball
                </>
              ) : (
                <>
                  Snowball is <strong>{formatCurrency(strategyComparison.savingsDifference, currency)}</strong> more expensive than Avalanche,
                  but may be easier to stick with
                </>
              )}
            </div>
          </div>
        )}

        {/* Recommendations */}
        {recommendation && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Recommended Payment Allocation</span>
              {recommendation.debtFreeDate && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Calendar className="w-3 h-3" />
                  Debt-free by {format(recommendation.debtFreeDate, 'MMM yyyy')}
                </div>
              )}
            </div>

            {recommendation.cardPayments.map((card) => (
              <div
                key={`${card.cardIssuer}-${card.cardLastFour}`}
                className={`p-3 rounded-lg border ${
                  card.priority === 1
                    ? 'bg-primary/5 border-primary/30'
                    : 'bg-muted/30 border-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        card.priority === 1
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {card.priority}
                    </div>
                    <div>
                      <div className="text-sm font-medium">
                        {card.cardIssuer} ****{card.cardLastFour}
                      </div>
                      <div className="text-xs text-muted-foreground">{card.reason}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm font-semibold">
                      {formatCurrency(card.recommendedPayment, currency)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Balance: {formatCurrency(card.balance, currency)}
                    </div>
                  </div>
                </div>
                {card.priority === 1 && card.recommendedPayment > card.balance * 0.1 && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-primary">
                    <ArrowUpRight className="w-3 h-3" />
                    Focus extra payments here first
                  </div>
                )}
              </div>
            ))}

            {/* Summary */}
            {recommendation.projectedSavings > 0 && (
              <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-300">
                  <TrendingDown className="w-4 h-4" />
                  Projected Interest Savings
                </div>
                <div className="font-mono font-bold text-green-700 dark:text-green-300">
                  {formatCurrency(recommendation.projectedSavings, currency)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty state when no amount entered */}
        {!recommendation && (
          <div className="text-center py-4 text-muted-foreground text-sm">
            Enter an amount to see payment recommendations
          </div>
        )}
      </CardContent>
    </Card>
  );
}
