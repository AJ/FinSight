'use client';

import { format, addMonths, subMonths, startOfMonth } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface BudgetMonthPickerProps {
  selectedMonth: string;
  onMonthChange: (month: string) => void;
}

export function BudgetMonthPicker({ selectedMonth, onMonthChange }: BudgetMonthPickerProps) {
  const currentMonth = format(startOfMonth(new Date()), 'yyyy-MM');
  const selectedDate = startOfMonth(new Date(selectedMonth + '-01'));
  const isCurrent = selectedMonth === currentMonth;

  const handlePrev = () => {
    const prev = subMonths(selectedDate, 1);
    onMonthChange(format(prev, 'yyyy-MM'));
  };

  const handleNext = () => {
    const next = addMonths(selectedDate, 1);
    onMonthChange(format(next, 'yyyy-MM'));
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handlePrev}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-base font-semibold min-w-[150px] text-center">
          {format(selectedDate, 'MMMM yyyy')}
        </span>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleNext}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="h-5 flex items-center justify-center">
        <button
          onClick={() => onMonthChange(currentMonth)}
          className={cn(
            'text-[11px] border border-primary/30 text-primary rounded-full px-2.5 py-0.5 font-medium hover:bg-primary/10 transition-opacity',
            isCurrent && 'opacity-0 pointer-events-none'
          )}
        >
          Current
        </button>
      </div>
    </div>
  );
}
