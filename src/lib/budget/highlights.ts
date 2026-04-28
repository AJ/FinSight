import { BudgetProgress, Currency } from '@/types';
import { getCategoryDisplay } from '@/components/transactions/CategoryBadge';
import { formatCurrency } from '@/lib/currencyFormatter';

export interface Highlight {
  categoryId: string;
  type: 'over-budget' | 'warning' | 'on-track';
  text: string;
  dotColor: string;
}

export function buildHighlights(progress: BudgetProgress[], currency: Currency): Highlight[] {
  const overBudget: Highlight[] = [];
  const warning: Highlight[] = [];
  const onTrack: Highlight[] = [];

  for (const p of progress) {
    if (p.budgeted <= 0) continue;
    const name = getCategoryDisplay(p.categoryId).name;

    if (p.status === 'over-budget') {
      overBudget.push({
        categoryId: p.categoryId,
        type: 'over-budget',
        text: `${name} exceeded budget by ${formatCurrency(p.spent - p.budgeted, currency, false)}`,
        dotColor: 'bg-red-500',
      });
    } else if (p.status === 'warning') {
      warning.push({
        categoryId: p.categoryId,
        type: 'warning',
        text: `${name} at ${p.percentUsed}% — likely to exceed this month`,
        dotColor: 'bg-yellow-500',
      });
    } else {
      onTrack.push({
        categoryId: p.categoryId,
        type: 'on-track',
        text: `${name} on track at ${p.percentUsed}% of budget`,
        dotColor: 'bg-green-500',
      });
    }
  }

  onTrack.sort((a, b) => {
    const aBudget = progress.find(p => p.categoryId === a.categoryId)?.budgeted ?? 0;
    const bBudget = progress.find(p => p.categoryId === b.categoryId)?.budgeted ?? 0;
    return bBudget - aBudget;
  });

  return [...overBudget, ...warning, ...onTrack].slice(0, 3);
}
