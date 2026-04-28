'use client';

import { Button } from '@/components/ui/button';
import { AlertTriangle, Pencil, X } from 'lucide-react';

interface BudgetInfoBannerProps {
  onSetBudget: () => void;
  onDismiss?: () => void;
}

export function BudgetInfoBanner({ onSetBudget, onDismiss }: BudgetInfoBannerProps) {
  return (
    <div className="flex items-center justify-between bg-warning/10 border border-warning/20 rounded-lg px-4 py-3 gap-4">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
        <p className="text-sm text-warning">
          Showing actual spending only — no budget has been set for this month.
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Button size="sm" onClick={onSetBudget}>
          <Pencil className="h-3.5 w-3.5 mr-1.5" />
          Set Budget
        </Button>
        {onDismiss && (
          <button onClick={onDismiss} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
