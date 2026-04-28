'use client';

import { BudgetProgress, Currency, Transaction } from '@/types';
import { BudgetTableRow } from './BudgetTableRow';
import { Button } from '@/components/ui/button';
import { Pencil } from 'lucide-react';

interface BudgetTableProps {
  progress: BudgetProgress[];
  currency: Currency;
  transactions: Transaction[];
  selectedMonth: string;
  hasBudget: boolean;
  onEditBudget: () => void;
}

export function BudgetTable({ progress, currency, transactions, selectedMonth, hasBudget, onEditBudget }: BudgetTableProps) {
  const visibleProgress = progress.filter(p => p.budgeted > 0 || p.spent > 0);

  if (visibleProgress.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg py-12 text-center">
        <p className="text-sm text-muted-foreground mb-3">No spending data for this month.</p>
        <Button variant="outline" size="sm" onClick={onEditBudget}>
          Set up a budget
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="grid grid-cols-[1.8fr_0.8fr_0.8fr_0.8fr_1.5fr_1.2fr_80px] items-center py-2.5 px-4 text-[11px] text-muted-foreground uppercase tracking-wider border-b border-border">
        <span>Category</span>
        <span className="text-center">Budget</span>
        <span className="text-center">Spent</span>
        <span className="text-center">Left</span>
        <span className="text-center">Trend</span>
        <span />
        <span className="text-center">Status</span>
      </div>

      {visibleProgress.map((p) => (
        <BudgetTableRow
          key={p.categoryId}
          progress={p}
          currency={currency}
          transactions={transactions}
          selectedMonth={selectedMonth}
          hasBudget={hasBudget}
        />
      ))}

      <div className="flex justify-end pt-3 pb-3 px-4">
        <Button variant="outline" size="sm" onClick={onEditBudget}>
          <Pencil className="h-3 w-3 mr-1.5" />
          Edit budget
        </Button>
      </div>
    </div>
  );
}
