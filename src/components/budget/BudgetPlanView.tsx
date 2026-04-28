'use client';

import { useState, useMemo } from 'react';
import { Currency, Transaction } from '@/types';
import { getBudgetableCategories } from '@/lib/budget/categoryEligibility';
import { forecastCategorySpending } from '@/lib/forecaster';
import { getCategoryDisplay } from '@/components/transactions/CategoryBadge';
import { BudgetPlanCategoryRow } from './BudgetPlanCategoryRow';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/currencyFormatter';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Wand2, LayoutTemplate, Plus, Grid3X3 } from 'lucide-react';

type TemplateId = '50/30/20' | '60/20/20' | '70/20/10';

interface BudgetPlanViewProps {
  month: string;
  income: number;
  allocations: Record<string, number>;
  visibleCategoryIds: string[];
  hiddenCategoryIds: string[];
  currency: Currency;
  transactions: Transaction[];
  isDirty: boolean;
  isOverAllocated: boolean;
  medianIncome: number;
  onIncomeChange: (amount: number) => void;
  onAllocationChange: (categoryId: string, amount: number) => void;
  onRemoveCategory: (categoryId: string) => void;
  onAddCategory: (categoryId: string) => void;
  onAutoFill: () => void;
  onApplyTemplate: (template: TemplateId) => void;
  onReset: () => void;
  onSave: () => void;
}

export function BudgetPlanView({
  month,
  income,
  allocations,
  visibleCategoryIds,
  hiddenCategoryIds,
  currency,
  transactions,
  isDirty,
  isOverAllocated,
  medianIncome,
  onIncomeChange,
  onAllocationChange,
  onRemoveCategory,
  onAddCategory,
  onAutoFill,
  onApplyTemplate,
  onReset,
  onSave,
}: BudgetPlanViewProps) {
  const budgetableCats = useMemo(() => getBudgetableCategories(), []);
  const hasSpendingHistory = useMemo(
    () => budgetableCats.some(c => forecastCategorySpending(transactions, c.id) > 0),
    [transactions, budgetableCats]
  );

  const totalAllocated = Object.values(allocations).reduce((s, v) => s + v, 0);
  const unallocated = income - totalAllocated;
  const allocPct = income > 0 ? Math.round((totalAllocated / income) * 100) : 0;

  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const pendingRemoveName = pendingRemove
    ? getCategoryDisplay(pendingRemove).name
    : '';
  const pendingRemoveAmount = pendingRemove ? allocations[pendingRemove] ?? 0 : 0;

  const handleRemove = (categoryId: string) => {
    const amount = allocations[categoryId] ?? 0;
    if (amount > 0) {
      setPendingRemove(categoryId);
    } else {
      onRemoveCategory(categoryId);
    }
  };

  const confirmRemove = () => {
    if (pendingRemove) {
      onRemoveCategory(pendingRemove);
      setPendingRemove(null);
    }
  };

  const hasCategories = visibleCategoryIds.length > 0;

  const canSave = isDirty && !isOverAllocated && income > 0 && hasCategories;
  const saveDisabledReason = !isDirty ? 'No changes to save'
    : isOverAllocated ? 'Over-allocated — reduce category amounts to fit within budget'
    : income === 0 ? 'Set a total budget first'
    : !hasCategories ? 'Add at least one category'
    : '';

  const canApplyTemplate = income > 0 || medianIncome > 0;
  const canAutoFill = (income > 0 || medianIncome > 0) && hasSpendingHistory;

  return (
    <div className="space-y-5">
      {/* Fix #2: Income — label and input on same row, input has fixed width */}
      <div className="bg-card border-l-4 border-l-primary border border-border rounded-lg px-5 py-4">
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider shrink-0">Total Budget</p>
          <div className="flex items-center gap-3">
            <div className="relative w-44">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                {currency.symbol}
              </span>
              <input
                type="number"
                value={income || ''}
                onChange={(e) => onIncomeChange(parseFloat(e.target.value) || 0)}
                placeholder="0"
                className="w-full bg-background border border-input rounded-md pl-8 pr-3 py-1.5 text-sm font-semibold text-right focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {medianIncome > 0 && (
              <button
                onClick={() => onIncomeChange(medianIncome)}
                className="text-xs border border-primary/30 text-primary rounded-md px-3 py-1 hover:bg-primary/10 transition-colors whitespace-nowrap"
              >
                Use {formatCurrency(medianIncome, currency, false)} (median)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Category Allocations */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">Category Allocations</h3>
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={onAutoFill}
              disabled={!canAutoFill}
              title={!canAutoFill
                ? (!hasSpendingHistory ? 'No spending history available' : 'No budget or median income to distribute')
                : ''}
            >
              <Wand2 className="h-3.5 w-3.5 mr-1" />
              Auto-fill
            </Button>
            {/* Fix #6: Template disabled with feedback when no income */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canApplyTemplate}
                  title={!canApplyTemplate ? 'No budget or median income to distribute' : ''}
                >
                  <LayoutTemplate className="h-3.5 w-3.5 mr-1" />
                  Template
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onApplyTemplate('50/30/20')}>
                  50/30/20 (Needs/Wants/Saves)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onApplyTemplate('60/20/20')}>
                  60/20/20
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onApplyTemplate('70/20/10')}>
                  70/20/10
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {hiddenCategoryIds.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {hiddenCategoryIds.map(catId => {
                    const display = getCategoryDisplay(catId);
                    return (
                      <DropdownMenuItem key={catId} onClick={() => onAddCategory(catId)}>
                        {display.name}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Empty state */}
        {!hasCategories && (
          <div className="bg-card border border-border rounded-lg py-12 flex flex-col items-center justify-center">
            <div className="w-14 h-14 rounded-xl bg-muted/50 flex items-center justify-center mb-4">
              <Grid3X3 className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium mb-1">No categories yet</p>
            <p className="text-xs text-muted-foreground text-center max-w-xs">
              Use Auto-fill to populate from your spending history, or add categories manually.
            </p>
          </div>
        )}

        {/* Category table */}
        {hasCategories && (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {visibleCategoryIds.map((catId) => (
              <BudgetPlanCategoryRow
                key={catId}
                categoryId={catId}
                amount={allocations[catId] ?? 0}
                currency={currency}
                isHovered={hoveredRow === catId}
                onAmountChange={onAllocationChange}
                onRemove={handleRemove}
                onHoverChange={setHoveredRow}
              />
            ))}
          </div>
        )}

        {/* Fix #5: Summary — show whenever categories exist, with allocated % */}
        {hasCategories && (
          <div className="mt-3 text-sm flex items-center gap-3">
            <span className="text-muted-foreground">
              Allocated: <span className="text-foreground font-medium">{formatCurrency(totalAllocated, currency, false)}</span>
            </span>
            {income > 0 ? (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{allocPct}% of budget</span>
                <span className="text-muted-foreground">·</span>
                {unallocated >= 0 ? (
                  <span className="text-primary font-medium">
                    +{formatCurrency(unallocated, currency, false)} unallocated
                  </span>
                ) : (
                  <span className="text-red-500 font-medium">
                    {formatCurrency(Math.abs(unallocated), currency, false)} over-allocated
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-red-400 font-medium">No Total Budget set</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onReset}
          disabled={!isDirty}
        >
          Reset
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={!canSave}
          title={saveDisabledReason}
        >
          Save
        </Button>
      </div>

      {/* Remove confirmation dialog */}
      <Dialog open={!!pendingRemove} onOpenChange={(open) => !open && setPendingRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove category?</DialogTitle>
            <DialogDescription>
              {pendingRemoveName} has a {formatCurrency(pendingRemoveAmount, currency, false)} allocation. Remove anyway?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRemove(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmRemove}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
