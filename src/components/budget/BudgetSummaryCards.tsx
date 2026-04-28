'use client';

import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/lib/currencyFormatter';
import { Currency } from '@/types';

interface BudgetSummaryCardsProps {
  income: number | null;
  budgeted: number;
  spent: number;
  remaining: number;
  currency: Currency;
  hasBudget: boolean;
}

export function BudgetSummaryCards({
  income,
  budgeted,
  spent,
  remaining,
  currency,
  hasBudget,
}: BudgetSummaryCardsProps) {
  const incomePct = income && income > 0 ? ((budgeted / income) * 100).toFixed(1) : null;
  const hasIncome = income != null && income > 0;
  const hasSpending = spent > 0;

  return (
    <div className="grid grid-cols-4 gap-3">
      {/* Income */}
      <Card>
        <CardContent className="p-3">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Income</p>
          <p className="text-2xl font-bold text-primary">
            {hasIncome ? formatCurrency(income!, currency, false) : '—'}
          </p>
          {hasIncome && <p className="text-[11px] text-muted-foreground mt-0.5">Actual</p>}
        </CardContent>
      </Card>

      {/* Budgeted */}
      <Card>
        <CardContent className="p-3">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Budgeted</p>
          <p className="text-2xl font-bold">
            {hasBudget ? formatCurrency(budgeted, currency, false) : '—'}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {!hasBudget
              ? 'No Budget'
              : incomePct
                ? `${incomePct}% of budget`
                : ''}
          </p>
        </CardContent>
      </Card>

      {/* Spent */}
      <Card>
        <CardContent className="p-3">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Spent</p>
          <p className={`text-2xl font-bold ${hasSpending ? 'text-red-400' : 'text-muted-foreground'}`}>
            {formatCurrency(spent, currency, false)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">This Month</p>
        </CardContent>
      </Card>

      {/* Balance */}
      <Card>
        <CardContent className="p-3">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Balance</p>
          {hasIncome || hasSpending ? (
            <>
              <p className={`text-2xl font-bold ${remaining >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {remaining < 0 && <span className="text-base">−</span>}
                {formatCurrency(Math.abs(remaining), currency, false)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Of Income</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold">—</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">—</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
