'use client';

import { useState, useMemo } from 'react';
import { useTransactionStore } from '@/lib/store/transactionStore';
import { useCategoryStore } from '@/lib/store/categoryStore';
import { useBudgetStore } from '@/lib/store/budgetStore';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { DollarSign, TrendingUp } from 'lucide-react';
import { forecastAllCategories, calculateAverageMonthlyIncome } from '@/lib/forecaster';
import { formatCurrency } from '@/lib/currencyFormatter';
import { format, addMonths, startOfMonth } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { Budget } from '@/types';
import { getCategoryDisplay, iconMap } from '@/components/transactions/CategoryBadge';

export default function BudgetPage() {
  const transactions = useTransactionStore((state) => state.transactions);
  const categories = useCategoryStore((state) => state.categories);
  const currency = useSettingsStore((state) => state.currency);
  const createBudget = useBudgetStore((state) => state.createBudget);

  const [budgetMonth] = useState(() => {
    const nextMonth = addMonths(startOfMonth(new Date()), 1);
    return format(nextMonth, 'yyyy-MM');
  });

  // Calculate forecasts
  const forecasts = useMemo(() => {
    const expenseCategories = categories.filter(
      (c) => c.type === 'expense' || c.type === 'both'
    );
    const categoryIds = expenseCategories.map((c) => c.id);
    return forecastAllCategories(transactions, categoryIds);
  }, [transactions, categories]);

  // Derived default values (computed from transactions)
  const defaultTotalIncome = useMemo(
    () => Math.round(calculateAverageMonthlyIncome(transactions)),
    [transactions]
  );

  const defaultAllocations = useMemo(() => {
    const initial: Record<string, number> = {};
    Object.keys(forecasts).forEach((categoryId) => {
      initial[categoryId] = Math.round(forecasts[categoryId]);
    });
    return initial;
  }, [forecasts]);

  // User-editable state, initialized from derived defaults
  const [totalIncome, setTotalIncome] = useState(() => defaultTotalIncome);
  const [budgetAllocations, setBudgetAllocations] = useState<Record<string, number>>(() => ({ ...defaultAllocations }));

  const totalAllocated = Object.values(budgetAllocations).reduce((sum, val) => sum + val, 0);
  const remaining = totalIncome - totalAllocated;

  const handleAllocationChange = (categoryId: string, value: number) => {
    setBudgetAllocations((prev) => ({
      ...prev,
      [categoryId]: value,
    }));
  };

  const handleAutoDistribute = () => {
    const totalProjected = Object.values(forecasts).reduce((sum, val) => sum + val, 0);

    if (totalProjected === 0) {
      alert('No spending data available to auto-distribute. Please manually set your budget.');
      return;
    }

    // Distribute proportionally
    const newAllocations: Record<string, number> = {};
    Object.entries(forecasts).forEach(([categoryId, projected]) => {
      const proportion = projected / totalProjected;
      newAllocations[categoryId] = Math.round(totalIncome * proportion);
    });

    setBudgetAllocations(newAllocations);
  };

  const handleResetToDefaults = () => {
    setTotalIncome(defaultTotalIncome);
    setBudgetAllocations({ ...defaultAllocations });
  };

  const handleSaveBudget = () => {
    const budget: Budget = {
      id: uuidv4(),
      month: budgetMonth,
      totalIncome,
      allocations: Object.entries(budgetAllocations).map(([categoryId, budgetedAmount]) => {
        const category = categories.find((c) => c.id === categoryId);
        return {
          categoryId,
          categoryName: category?.name || categoryId,
          projectedAmount: forecasts[categoryId] || 0,
          budgetedAmount,
        };
      }),
      createdAt: new Date(),
    };

    createBudget(budget);
    alert('Budget saved successfully!');
  };

  const expenseCategories = categories.filter(
    (c) => c.type === 'expense' || c.type === 'both'
  );

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Page Header */}
      <div className="border-b border-border bg-card">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Budget Planner</h1>
            <p className="text-sm text-muted-foreground">
              Plan your budget for {format(new Date(budgetMonth), 'MMMM yyyy')}
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={handleResetToDefaults}>
              Reset
            </Button>
            <Button variant="outline" onClick={handleAutoDistribute}>
              Auto-Distribute
            </Button>
            <Button onClick={handleSaveBudget}>Save Budget</Button>
          </div>
        </div>
      </div>

      <div className="p-6">
        {/* Overview Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-success/10 rounded-lg">
                  <DollarSign className="w-6 h-6 text-success" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Expected Income</p>
                  <p className="text-2xl font-bold">{formatCurrency(totalIncome, currency, false)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-lg">
                  <TrendingUp className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Allocated</p>
                  <p className="text-2xl font-bold">{formatCurrency(totalAllocated, currency, false)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-lg ${remaining >= 0 ? 'bg-success/10' : 'bg-destructive/10'}`}>
                  <DollarSign className={`w-6 h-6 ${remaining >= 0 ? 'text-success' : 'text-destructive'}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Remaining</p>
                  <p className={`text-2xl font-bold ${remaining >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {formatCurrency(remaining, currency, false)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Income Input */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Expected Income</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <Label htmlFor="income">Monthly Income</Label>
                <Input
                  id="income"
                  type="number"
                  value={totalIncome}
                  onChange={(e) => setTotalIncome(Number(e.target.value))}
                  className="mt-2"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Category Budgets */}
        <Card>
          <CardHeader>
            <CardTitle>Category Budgets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {expenseCategories.map((category) => {
                const projected = Math.round(forecasts[category.id] || 0);
                const budgeted = budgetAllocations[category.id] || 0;
                const maxBudget = totalIncome;
                const IconComponent = iconMap[category.icon || ""] || getCategoryDisplay(category.id).icon;

                return (
                  <div key={category.id} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <IconComponent className="w-5 h-5" style={{ color: category.color }} />
                        <div>
                          <p className="font-medium">{category.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Projected: {formatCurrency(projected, currency, false)}
                          </p>
                        </div>
                      </div>
                      <Input
                        type="number"
                        value={budgeted}
                        onChange={(e) =>
                          handleAllocationChange(category.id, Number(e.target.value))
                        }
                        className="w-32"
                      />
                    </div>
                    <Slider
                      value={[budgeted]}
                      onValueChange={(values) =>
                        handleAllocationChange(category.id, values[0])
                      }
                      max={maxBudget}
                      step={10}
                      className="w-full"
                    />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
