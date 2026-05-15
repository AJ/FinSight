'use client';

import { Suspense, useState, useMemo, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTransactionStore } from '@/lib/store/transactionStore';
import { useBudgetStore } from '@/lib/store/budgetStore';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { BudgetMonthPicker } from '@/components/budget/BudgetMonthPicker';
import { BudgetSummaryCards } from '@/components/budget/BudgetSummaryCards';
import { BudgetTable } from '@/components/budget/BudgetTable';
import { BudgetPlanView } from '@/components/budget/BudgetPlanView';
import { BudgetEmptyState } from '@/components/budget/BudgetEmptyState';
import { BudgetInfoBanner } from '@/components/budget/BudgetInfoBanner';
import { BudgetHighlights } from '@/components/budget/BudgetHighlights';
import { getBudgetableCategoryIds, partitionCategories } from '@/lib/budget/categoryEligibility';
import { computeAutoFill } from '@/lib/budget/autoFill';
import { computeTemplateAllocation } from '@/lib/budget/templateApply';
import { computeAllocationSummary, computeSummaryTotals } from '@/lib/budget/progressCalculation';
import { findCarryForwardState, isBudgetDirty } from '@/lib/budget/carryForward';
import { calculateMedianMonthlyIncome } from '@/lib/forecaster';
import { format, startOfMonth } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

type TemplateId = '50/30/20' | '60/20/20' | '70/20/10';

function BudgetPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const transactions = useTransactionStore((s) => s.transactions);
  const currency = useSettingsStore((s) => s.currency);
  const budgetStore = useBudgetStore();

  const initialTab = searchParams.get('tab') === 'plan' ? 'plan' : 'track';
  const initialMonth = searchParams.get('month') || format(startOfMonth(new Date()), 'yyyy-MM');
  const [tab, setTab] = useState(initialTab);
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);

  const period = budgetStore.getPeriod(selectedMonth);
  const medianIncome = useMemo(
    () => Math.round(calculateMedianMonthlyIncome(transactions)),
    [transactions]
  );

  const monthTransactions = useMemo(
    () => transactions.filter(t => format(t.date, 'yyyy-MM') === selectedMonth),
    [transactions, selectedMonth]
  );

  const progress = useMemo(
    () => budgetStore.computeProgress(selectedMonth, monthTransactions),
    [budgetStore, selectedMonth, monthTransactions]
  );

  const summaryData = useMemo(() =>
    computeSummaryTotals(progress, period?.income ?? null),
  [progress, period]);

  const hasBudget = !!period;
  const hasAnyData = hasBudget || monthTransactions.length > 0;

  // Plan tab: local dirty state — use carry-forward when no period exists for this month
  const initialCarryForward = useMemo(
    () => findCarryForwardState({ month: selectedMonth, periods: useBudgetStore.getState().periods }),
    [], // eslint-disable-line react-hooks/exhaustive-deps -- intentional: compute once on mount
  );
  const [localIncome, setLocalIncome] = useState<number>(period?.income ?? initialCarryForward.income);
  const [localAllocations, setLocalAllocations] = useState<Record<string, number>>(
    () => period?.allocations
      ? Object.fromEntries(period.allocations.map(a => [a.categoryId, a.amount]))
      : initialCarryForward.allocations,
  );
  const [localHidden, setLocalHidden] = useState<string[]>(period?.hiddenCategories ?? initialCarryForward.hidden);

  // Reset local state when month changes (synchronous during render, no effect cascading)
  const [prevMonth, setPrevMonth] = useState(selectedMonth);
  if (prevMonth !== selectedMonth) {
    setPrevMonth(selectedMonth);
    const result = findCarryForwardState({ month: selectedMonth, periods: useBudgetStore.getState().periods });
    setLocalIncome(result.income);
    setLocalAllocations(result.allocations);
    setLocalHidden(result.hidden);
  }

  const loadMonthState = useCallback((month: string) => {
    const allPeriods = useBudgetStore.getState().periods;
    const result = findCarryForwardState({ month, periods: allPeriods });
    setLocalIncome(result.income);
    setLocalAllocations(result.allocations);
    setLocalHidden(result.hidden);
  }, []);

  // Dirty tracking
  const isDirty = useMemo(() =>
    isBudgetDirty({ localIncome, localAllocations, localHidden, period }),
  [localIncome, localAllocations, localHidden, period]);

  const { isOverAllocated } = computeAllocationSummary(localIncome, localAllocations);

  // Unsaved changes dialog
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [pendingMonth, setPendingMonth] = useState<string | null>(null);

  const handleMonthChange = useCallback((month: string) => {
    if (isDirty && tab === 'plan') {
      setPendingMonth(month);
      setShowDiscardDialog(true);
      return;
    }
    setSelectedMonth(month);
    router.push(`/budget?tab=${tab}&month=${month}`, { scroll: false });
  }, [tab, router, isDirty]);

  const confirmDiscard = () => {
    setShowDiscardDialog(false);
    if (pendingMonth) {
      setSelectedMonth(pendingMonth);
      router.push(`/budget?tab=${tab}&month=${pendingMonth}`, { scroll: false });
      setPendingMonth(null);
    }
  };

  const handleTabChange = useCallback((value: string) => {
    setTab(value);
    router.push(`/budget?tab=${value}&month=${selectedMonth}`, { scroll: false });
  }, [selectedMonth, router]);

  const handleEditBudget = useCallback(() => {
    setTab('plan');
    router.push(`/budget?tab=plan&month=${selectedMonth}`, { scroll: false });
  }, [selectedMonth, router]);

  const handleSave = useCallback(() => {
    const store = useBudgetStore.getState();
    store.setIncome(selectedMonth, localIncome);

    // Get current state to diff allocations
    const currentPeriod = store.getPeriod(selectedMonth);
    const currentAllocIds = new Set((currentPeriod?.allocations ?? []).map(a => a.categoryId));

    for (const [catId, amount] of Object.entries(localAllocations)) {
      store.setAllocation(selectedMonth, catId, amount);
    }

    // Remove allocations that are no longer present
    for (const catId of currentAllocIds) {
      if (!(catId in localAllocations)) {
        store.removeAllocation(selectedMonth, catId);
      }
    }

    // Handle hidden categories
    const currentHidden = currentPeriod?.hiddenCategories ?? [];
    for (const catId of localHidden) {
      if (!currentHidden.includes(catId)) store.hideCategory(selectedMonth, catId);
    }
    for (const catId of currentHidden) {
      if (!localHidden.includes(catId)) store.addCategory(selectedMonth, catId);
    }

    store.savePeriod(selectedMonth);
    toast.success(`Budget for ${selectedMonth} saved`);
    handleTabChange('track');
  }, [selectedMonth, localIncome, localAllocations, localHidden, handleTabChange]);

  const handleReset = useCallback(() => {
    loadMonthState(selectedMonth);
  }, [selectedMonth, loadMonthState]);

  const handleAutoFill = useCallback(() => {
    const result = computeAutoFill({ localIncome, medianIncome, transactions });
    if (!result) return;
    setLocalIncome(result.income);
    setLocalAllocations(result.allocations);
    setLocalHidden(result.hidden);
  }, [transactions, localIncome, medianIncome]);

  const handleApplyTemplate = useCallback((template: TemplateId) => {
    const result = computeTemplateAllocation({ template, localIncome, medianIncome, transactions });
    if (!result) return;
    setLocalIncome(result.income);
    setLocalAllocations(result.allocations);
    setLocalHidden(result.hidden);
  }, [localIncome, medianIncome, transactions]);

  const handleAllocationChange = useCallback((categoryId: string, amount: number) => {
    setLocalAllocations(prev => ({ ...prev, [categoryId]: amount }));
  }, []);

  const handleRemoveCategory = useCallback((categoryId: string) => {
    setLocalAllocations(prev => {
      const next = { ...prev };
      delete next[categoryId];
      return next;
    });
    setLocalHidden(prev => prev.includes(categoryId) ? prev : [...prev, categoryId]);
  }, []);

  const handleAddCategory = useCallback((categoryId: string) => {
    setLocalHidden(prev => prev.filter(id => id !== categoryId));
    if (!(categoryId in localAllocations)) {
      setLocalAllocations(prev => ({ ...prev, [categoryId]: 0 }));
    }
  }, [localAllocations]);

  // Derived: visible and hidden category lists
  const allCategoryIds = getBudgetableCategoryIds();
  const { visible: visibleCategoryIds, hidden: hiddenCategoryIds } = partitionCategories(allCategoryIds, localHidden, localAllocations);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Budget</h1>
            <p className="text-sm text-muted-foreground">Plan and track your monthly spending.</p>
          </div>
          <BudgetMonthPicker selectedMonth={selectedMonth} onMonthChange={handleMonthChange} />
        </div>
      </div>

      {/* Content */}
      <div className="p-6 space-y-4">
        {/* Tabs */}
        <div className="inline-flex gap-2 bg-card border border-border rounded-lg p-1">
          <button
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              tab === 'track'
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:text-foreground/80'
            )}
            onClick={() => handleTabChange('track')}
          >
            Track
          </button>
          <button
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              tab === 'plan'
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:text-foreground/80'
            )}
            onClick={() => handleTabChange('plan')}
          >
            Plan
          </button>
        </div>
        {tab === 'track' && !hasAnyData ? (
          <BudgetEmptyState
            selectedMonth={selectedMonth}
            hasTransactions={monthTransactions.length > 0}
            onSetupBudget={handleEditBudget}
          />
        ) : tab === 'track' ? (
          <>
            <BudgetSummaryCards
              income={summaryData.income}
              budgeted={summaryData.budgeted}
              spent={summaryData.spent}
              remaining={summaryData.remaining}
              currency={currency}
              hasBudget={hasBudget}
            />

            {!hasBudget && monthTransactions.length > 0 && (
              <BudgetInfoBanner onSetBudget={handleEditBudget} />
            )}

            {hasBudget && (
              <BudgetHighlights progress={progress} currency={currency} />
            )}

            <BudgetTable
              progress={progress}
              currency={currency}
              transactions={transactions}
              selectedMonth={selectedMonth}
              hasBudget={hasBudget}
              onEditBudget={handleEditBudget}
            />
          </>
        ) : (
          <BudgetPlanView
            month={selectedMonth}
            income={localIncome}
            allocations={localAllocations}
            visibleCategoryIds={visibleCategoryIds}
            hiddenCategoryIds={hiddenCategoryIds}
            currency={currency}
            transactions={transactions}
            isDirty={isDirty}
            isOverAllocated={isOverAllocated}
            medianIncome={medianIncome}
            onIncomeChange={setLocalIncome}
            onAllocationChange={handleAllocationChange}
            onRemoveCategory={handleRemoveCategory}
            onAddCategory={handleAddCategory}
            onAutoFill={handleAutoFill}
            onApplyTemplate={handleApplyTemplate}
            onReset={handleReset}
            onSave={handleSave}
          />
        )}
      </div>

      {/* Unsaved changes dialog */}
      <Dialog open={showDiscardDialog} onOpenChange={setShowDiscardDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>
              You have unsaved changes. Discard them and switch months?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDiscardDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDiscard}>Discard</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function BudgetPage() {
  return (
    <Suspense>
      <BudgetPageContent />
    </Suspense>
  );
}
