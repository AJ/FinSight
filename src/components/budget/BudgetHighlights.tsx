'use client';

import { BudgetProgress, Currency } from '@/types';
import { buildHighlights } from '@/lib/budget/highlights';

interface BudgetHighlightsProps {
  progress: BudgetProgress[];
  currency: Currency;
}

export function BudgetHighlights({ progress, currency }: BudgetHighlightsProps) {
  const highlights = buildHighlights(progress, currency);

  if (highlights.length === 0) return null;

  return (
    <div className="grid grid-cols-3 gap-3">
      {highlights.map((h) => (
        <div
          key={h.categoryId + h.type}
          className="bg-card border border-border rounded-lg px-3 py-2 flex items-center gap-2"
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${h.dotColor}`} />
          <span className="text-sm">{h.text}</span>
        </div>
      ))}
    </div>
  );
}
