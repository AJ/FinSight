"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Wallet, TrendingDown, Building2, CreditCard } from "lucide-react";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";

interface TrueBalanceWidgetProps {
  /** Variant: 'true' shows bank-CC, 'total' shows sum of CC dues only */
  variant?: "true" | "total";
  /** Compact mode hides breakdown details */
  compact?: boolean;
}

/**
 * True Balance Widget
 *
 * Shows the real "available" balance by subtracting CC outstanding from bank balance.
 * This gives users an accurate picture of their financial position.
 *
 * In 'total' variant, shows just the sum of all CC outstanding amounts.
 * In compact mode, shows a simplified KPI-style card.
 */
export function TrueBalanceWidget({ variant = "true", compact = false }: TrueBalanceWidgetProps) {
  const transactions = useTransactionStore((state) => state.transactions);
  const getTotalOutstanding = useCreditCardStore((state) => state.getTotalOutstanding);
  const getAllUniqueCards = useCreditCardStore((state) => state.getAllUniqueCards);
  const getMostRecentStatement = useCreditCardStore((state) => state.getMostRecentStatement);
  const currency = useSettingsStore((state) => state.currency);

  const ccOutstanding = getTotalOutstanding();

  const { bankBalance, trueBalance, breakdown } = useMemo(() => {
    // Calculate bank balance from non-CC transactions
    const bankIncome = transactions
      .filter((t) => t.sourceType !== "credit_card" && t.isIncome)
      .reduce((sum, t) => sum + t.amount, 0);

    const bankExpenses = transactions
      .filter((t) => t.sourceType !== "credit_card" && t.isExpense)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const bankBalance = bankIncome - bankExpenses;

    // True balance = bank balance - CC outstanding
    const trueBalance = bankBalance - ccOutstanding;

    // Get breakdown for total variant
    const cards = getAllUniqueCards();
    const breakdown: string[] = [];
    for (const card of cards) {
      const recent = getMostRecentStatement(card.cardIssuer, card.cardLastFour);
      if (recent && recent.totalDue > 0) {
        breakdown.push(formatCurrency(recent.totalDue, currency));
      }
    }

    return { bankBalance, trueBalance, breakdown };
  }, [transactions, ccOutstanding, currency, getAllUniqueCards, getMostRecentStatement]);

  // Don't show if no CC data
  if (ccOutstanding === 0) {
    return null;
  }

  // Compact mode: Simple KPI card
  if (compact) {
    if (variant === "total") {
      return (
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Total Balance
            </div>
            <div className="text-2xl font-bold mt-1.5">
              {formatCurrency(ccOutstanding, currency)}
            </div>
            {breakdown.length > 1 && (
              <div className="text-xs text-muted-foreground mt-1">
                {breakdown.join(" + ")}
              </div>
            )}
          </CardContent>
        </Card>
      );
    }

    // True balance compact
    return (
      <Card>
        <CardContent className="p-4">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            True Balance
          </div>
          <div className={`text-2xl font-bold mt-1.5 ${trueBalance < 0 ? "text-destructive" : "text-success"}`}>
            {formatCurrency(trueBalance, currency)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Bank {formatCurrency(bankBalance, currency)} · CC -{formatCurrency(ccOutstanding, currency)}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Full mode
  if (variant === "total") {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="w-4 h-4 text-primary" />
            Total Balance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="font-mono text-2xl font-bold">
            {formatCurrency(ccOutstanding, currency)}
          </div>
          {breakdown.length > 1 && (
            <div className="text-sm text-muted-foreground">
              {breakdown.join(" + ")}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="w-4 h-4 text-primary" />
          True Balance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Bank Balance */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="w-3 h-3" />
            Bank Balance
          </div>
          <span className="font-mono text-sm">
            {formatCurrency(bankBalance, currency)}
          </span>
        </div>

        {/* CC Outstanding */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <CreditCard className="w-3 h-3" />
            CC Outstanding
          </div>
          <span className="font-mono text-sm text-destructive">
            -{formatCurrency(ccOutstanding, currency)}
          </span>
        </div>

        <Separator />

        {/* True Balance */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Available</span>
          <span
            className={`font-mono text-lg font-bold ${
              trueBalance < 0 ? "text-destructive" : "text-success"
            }`}
          >
            {formatCurrency(trueBalance, currency)}
          </span>
        </div>

        {/* Warning if negative */}
        {trueBalance < 0 && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <TrendingDown className="w-3 h-3" />
            You owe more than you have
          </p>
        )}
      </CardContent>
    </Card>
  );
}
