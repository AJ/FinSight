"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Wallet, TrendingDown, Building2, CreditCard } from "lucide-react";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";

/**
 * True Balance Widget
 *
 * Shows the real "available" balance by subtracting CC outstanding from bank balance.
 * This gives users an accurate picture of their financial position.
 */
export function TrueBalanceWidget() {
  const transactions = useTransactionStore((state) => state.transactions);
  const getTotalOutstanding = useCreditCardStore((state) => state.getTotalOutstanding);
  const currency = useSettingsStore((state) => state.currency);

  const { bankBalance, ccOutstanding, trueBalance } = useMemo(() => {
    // Calculate bank balance from non-CC transactions
    // Include income/expense but exclude transfers (CC payments)
    const bankIncome = transactions
      .filter((t) => t.sourceType !== "credit_card" && t.isIncome)
      .reduce((sum, t) => sum + t.amount, 0);

    const bankExpenses = transactions
      .filter((t) => t.sourceType !== "credit_card" && t.isExpense)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const bankBalance = bankIncome - bankExpenses;

    // Get total CC outstanding from most recent statements
    const ccOutstanding = getTotalOutstanding();

    // True balance = bank balance - CC outstanding
    const trueBalance = bankBalance - ccOutstanding;

    return { bankBalance, ccOutstanding, trueBalance };
  }, [transactions, getTotalOutstanding]);

  // Don't show if no CC data
  if (ccOutstanding === 0) {
    return null;
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
