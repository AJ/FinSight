'use client';

import { motion } from 'framer-motion';
import { Landmark, CreditCard, FileSpreadsheet } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SourceType } from '@/models/SourceType';

interface StatementTypeSelectorProps {
  fileName: string;
  onSelect: (sourceType: SourceType) => void;
  onCancel: () => void;
  isProcessing?: boolean;
}

export function StatementTypeSelector({
  fileName,
  onSelect,
  onCancel,
  isProcessing = false,
}: StatementTypeSelectorProps) {
  const options = [
    {
      type: SourceType.Bank,
      icon: Landmark,
      title: 'Bank Statement',
      description: 'Checking, savings, or current account transactions',
      accentColor: 'emerald',
    },
    {
      type: SourceType.CreditCard,
      icon: CreditCard,
      title: 'Credit Card Statement',
      description: 'Credit card spending, payments, and balances',
      accentColor: 'violet',
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <Card className="border-border/60 shadow-sm">
        <CardContent className="p-6">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 text-sm text-muted-foreground mb-3">
              <FileSpreadsheet className="w-4 h-4" />
              <span className="font-medium truncate max-w-[200px]">{fileName}</span>
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              What type of statement is this?
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Select the statement type for accurate categorization
            </p>
          </div>

          {/* Options */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            {options.map((option, index) => (
              <motion.button
                key={option.type}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08, duration: 0.2 }}
                onClick={() => onSelect(option.type)}
                disabled={isProcessing}
                className={cn(
                  'group relative flex flex-col items-center p-5 rounded-xl border-2 transition-all duration-200',
                  'hover:border-transparent focus:outline-none focus:ring-2 focus:ring-offset-2',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  option.accentColor === 'emerald' && [
                    'border-emerald-200/60 bg-gradient-to-b from-emerald-50/50 to-transparent',
                    'hover:from-emerald-100/70 hover:to-emerald-50/30',
                    'focus:ring-emerald-500/50',
                    'dark:border-emerald-900/40 dark:from-emerald-950/30 dark:hover:from-emerald-900/40',
                  ],
                  option.accentColor === 'violet' && [
                    'border-violet-200/60 bg-gradient-to-b from-violet-50/50 to-transparent',
                    'hover:from-violet-100/70 hover:to-violet-50/30',
                    'focus:ring-violet-500/50',
                    'dark:border-violet-900/40 dark:from-violet-950/30 dark:hover:from-violet-900/40',
                  ]
                )}
              >
                {/* Icon container with subtle glow on hover */}
                <div
                  className={cn(
                    'relative w-14 h-14 rounded-xl flex items-center justify-center mb-3 transition-all duration-200',
                    'group-hover:scale-105',
                    option.accentColor === 'emerald' && [
                      'bg-emerald-100 dark:bg-emerald-900/50',
                      'shadow-[0_0_0_0_rgba(16,185,129,0)]',
                      'group-hover:shadow-[0_0_20px_4px_rgba(16,185,129,0.15)]',
                    ],
                    option.accentColor === 'violet' && [
                      'bg-violet-100 dark:bg-violet-900/50',
                      'shadow-[0_0_0_0_rgba(139,92,246,0)]',
                      'group-hover:shadow-[0_0_20px_4px_rgba(139,92,246,0.15)]',
                    ]
                  )}
                >
                  <option.icon
                    className={cn(
                      'w-7 h-7 transition-colors',
                      option.accentColor === 'emerald' && 'text-emerald-600 dark:text-emerald-400',
                      option.accentColor === 'violet' && 'text-violet-600 dark:text-violet-400'
                    )}
                    strokeWidth={1.75}
                  />
                </div>

                {/* Text */}
                <span className="font-semibold text-foreground text-sm mb-1">
                  {option.title}
                </span>
                <span className="text-xs text-muted-foreground text-center leading-relaxed">
                  {option.description}
                </span>

                {/* Selection indicator on hover */}
                <div
                  className={cn(
                    'absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none',
                    'ring-2 ring-offset-2',
                    option.accentColor === 'emerald' && 'ring-emerald-400/50 ring-offset-background',
                    option.accentColor === 'violet' && 'ring-violet-400/50 ring-offset-background'
                  )}
                />
              </motion.button>
            ))}
          </div>

          {/* Cancel button */}
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={isProcessing}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
