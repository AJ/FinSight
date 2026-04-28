'use client';

import { memo, useMemo } from 'react';
import { startOfMonth } from 'date-fns';
import { BudgetProgress, Currency, Transaction } from '@/types';
import { formatCurrency } from '@/lib/currencyFormatter';
import { getCategoryDisplay, getCategoryIcon } from '@/components/transactions/CategoryBadge';
import { computeSparklineData } from '@/lib/budget/sparklineData';
import { cn } from '@/lib/utils';

interface BudgetTableRowProps {
  progress: BudgetProgress;
  currency: Currency;
  transactions: Transaction[];
  selectedMonth: string;
  hasBudget: boolean;
}

const statusConfig: Record<BudgetProgress['status'], { label: string; className: string }> = {
  'on-track': { label: 'On Track', className: 'bg-green-500/15 text-green-400' },
  'warning': { label: 'Warning', className: 'bg-yellow-500/15 text-yellow-400' },
  'over-budget': { label: 'Over', className: 'bg-red-500/15 text-red-400' },
  'not-set': { label: 'No budget', className: 'bg-muted text-muted-foreground' },
};

export const BudgetTableRow = memo(function BudgetTableRow({
  progress,
  currency,
  transactions,
  selectedMonth,
}: BudgetTableRowProps) {
  const { categoryId, budgeted, spent, remaining, percentUsed, status } = progress;
  const display = getCategoryDisplay(categoryId);
  const IconComponent = getCategoryIcon(categoryId);
  const sparkline = useMemo(
    () => computeSparklineData(transactions, categoryId, 5, startOfMonth(new Date(selectedMonth + '-01'))),
    [transactions, categoryId, selectedMonth]
  );
  const config = statusConfig[status];

  const isOverBudget = percentUsed >= 100;
  const isWarning = percentUsed >= 80 && !isOverBudget;
  const sparklineColor = isOverBudget ? '#ef4444' : isWarning ? '#eab308' : '#22c55e';
  const isNotSet = status === 'not-set';

  return (
    <div
      className={cn(
        'grid grid-cols-[1.8fr_0.8fr_0.8fr_0.8fr_1.5fr_1.2fr_80px] items-center py-3.5 px-4 border-b border-border/40 hover:bg-muted/20 transition-colors text-sm',
        isNotSet && 'opacity-60'
      )}
    >
      {/* Category */}
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0',
            isNotSet && 'border border-dashed border-border'
          )}
          style={!isNotSet ? { background: `${display.color}15`, color: display.color } : {}}
        >
          <IconComponent className="h-4 w-4" />
        </div>
        <span className="font-medium text-sm">{display.name}</span>
      </div>

      {/* Budget */}
      <div className="text-center">
        {budgeted > 0 ? (
          <span>{formatCurrency(budgeted, currency, false)}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </div>

      {/* Spent */}
      <div className={cn('text-center', isOverBudget && budgeted > 0 && 'text-red-400')}>
        {formatCurrency(spent, currency, false)}
      </div>

      {/* Remaining */}
      <div className={cn('text-center', remaining >= 0 ? 'text-green-500' : 'text-red-500')}>
        {budgeted > 0 ? (
          <>
            {remaining < 0 && <span className="text-xs">−</span>}
            {formatCurrency(Math.abs(remaining), currency, false)}
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>

      {/* Sparkline */}
      <div>
        <svg width="100%" height="28" viewBox="0 0 100 28" preserveAspectRatio="none">
          <line x1="0" y1="26" x2="100" y2="26" stroke="currentColor" strokeOpacity="0.06" strokeWidth="0.5" />
          {isOverBudget && budgeted > 0 && (
            <line x1="0" y1="8" x2="100" y2="8" stroke="#ef4444" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.25" />
          )}
          {sparkline.length > 1 && (() => {
            const max = Math.max(...sparkline.map(p => p.amount), 1);
            const points = sparkline.map((p, i) => {
              const x = 5 + (i / (sparkline.length - 1)) * 90;
              const y = 22 - (p.amount / max) * 18;
              return `${x},${y}`;
            }).join(' ');

            const dotPositions = sparkline.map((p, i) => {
              const x = 5 + (i / (sparkline.length - 1)) * 90;
              const y = 22 - (p.amount / max) * 18;
              return { x, y };
            });

            return (
              <g>
                <polyline
                  fill="none"
                  stroke={sparklineColor}
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={points}
                />
                {dotPositions.map((pos, i) => (
                  <circle
                    key={i}
                    cx={pos.x}
                    cy={pos.y}
                    r={i === dotPositions.length - 1 ? 2.5 : 1.5}
                    fill={sparklineColor}
                    opacity={i === dotPositions.length - 1 ? 1 : 0.4}
                  />
                ))}
              </g>
            );
          })()}
        </svg>
      </div>

      {/* Status */}
      <div className="text-center">
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${config.className}`}>
          {config.label}
        </span>
      </div>
    </div>
  );
});
