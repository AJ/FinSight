'use client';

import { getCategoryDisplay, getCategoryIcon } from '@/components/transactions/CategoryBadge';
import { formatCurrency } from '@/lib/currencyFormatter';
import { Currency } from '@/types';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const NEEDS = new Set(['groceries', 'housing', 'utilities', 'healthcare', 'insurance', 'bills', 'taxes', 'fees', 'transportation']);
const WANTS = new Set(['dining', 'entertainment', 'shopping', 'travel', 'education']);
const SAVES = new Set(['investment', 'other', 'interest-expense']);

type CategoryGroup = 'Needs' | 'Wants' | 'Saves';

function getCategoryGroup(categoryId: string): CategoryGroup | null {
  if (NEEDS.has(categoryId)) return 'Needs';
  if (WANTS.has(categoryId)) return 'Wants';
  if (SAVES.has(categoryId)) return 'Saves';
  return null;
}

const groupStyles: Record<CategoryGroup, string> = {
  Needs: 'bg-blue-500/15 text-blue-400',
  Wants: 'bg-purple-500/15 text-purple-400',
  Saves: 'bg-green-500/15 text-green-400',
};

interface BudgetPlanCategoryRowProps {
  categoryId: string;
  amount: number;
  currency: Currency;
  isHovered: boolean;
  onAmountChange: (categoryId: string, amount: number) => void;
  onRemove: (categoryId: string) => void;
  onHoverChange: (categoryId: string | null) => void;
}

export function BudgetPlanCategoryRow({
  categoryId,
  amount,
  currency,
  isHovered,
  onAmountChange,
  onRemove,
  onHoverChange,
}: BudgetPlanCategoryRowProps) {
  const display = getCategoryDisplay(categoryId);
  const IconComponent = getCategoryIcon(categoryId);
  const group = getCategoryGroup(categoryId);

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 py-3 px-4 border-b border-border/40 transition-colors',
        isHovered && 'bg-muted/20'
      )}
      onMouseEnter={() => onHoverChange(categoryId)}
      onMouseLeave={() => onHoverChange(null)}
    >
      {/* Left: icon + name + group pill as flex group */}
      <div className="flex items-center gap-2.5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `${display.color}12`, color: display.color }}
        >
          <IconComponent className="h-4 w-4" />
        </div>
        <span className="font-medium text-sm whitespace-nowrap">{display.name}</span>
        {group && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${groupStyles[group]}`}>
            {group}
          </span>
        )}
      </div>

      {/* Right: budget input + remove */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="relative w-32">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
            {currency.symbol}
          </span>
          <input
            type="number"
            value={amount || ''}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              onAmountChange(categoryId, isNaN(val) ? 0 : Math.max(0, val));
            }}
            placeholder="0"
            className="w-full bg-background border border-input rounded-md pl-7 pr-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <button
          onClick={() => onRemove(categoryId)}
          className={cn(
            'w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all',
            isHovered ? 'opacity-100' : 'opacity-0'
          )}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
