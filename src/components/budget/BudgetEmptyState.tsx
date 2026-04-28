'use client';

import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { BarChart3, Pencil } from 'lucide-react';

interface BudgetEmptyStateProps {
  selectedMonth: string;
  hasTransactions: boolean;
  onSetupBudget: () => void;
}

export function BudgetEmptyState({ selectedMonth, hasTransactions, onSetupBudget }: BudgetEmptyStateProps) {
  const monthLabel = format(new Date(selectedMonth + '-01'), 'MMMM yyyy');

  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center max-w-sm">
        <div className="w-20 h-20 mx-auto mb-6 rounded-xl bg-primary/12 flex items-center justify-center">
          <BarChart3 className="w-10 h-10 text-primary" />
        </div>

        <h2 className="text-2xl font-bold text-foreground mb-2">No Budget Set</h2>
        <p className="text-muted-foreground mb-8 leading-relaxed">
          {hasTransactions
            ? `You have transactions for ${monthLabel}, but no budget has been created yet. Set up a budget to start tracking your spending.`
            : `No transactions or budget for ${monthLabel}.`}
        </p>

        <button
          onClick={onSetupBudget}
          className="text-sm font-medium text-foreground hover:text-primary transition-colors inline-flex items-center gap-1.5"
        >
          <Pencil className="w-4 h-4" />
          Create Your Budget
        </button>
      </div>
    </div>
  );
}
