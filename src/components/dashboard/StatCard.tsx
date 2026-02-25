'use client';

import { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { formatCurrency } from '@/lib/currencyFormatter';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: number | string;
  icon: ReactNode;
  trend: 'positive' | 'negative' | 'neutral';
  isPercentage?: boolean;
}

export function StatCard({ title, value, icon, trend, isPercentage = false }: StatCardProps) {
  const currency = useSettingsStore((state) => state.currency);

  const formattedValue = typeof value === 'number' && !isPercentage
    ? formatCurrency(value, currency, false)
    : value;

  const trendColors = {
    positive: 'text-success',
    negative: 'text-destructive',
    neutral: 'text-muted-foreground',
  };

  const bgColors = {
    positive: 'bg-success/10',
    negative: 'bg-destructive/10',
    neutral: 'bg-muted/50',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className={cn('p-2.5 rounded-lg shrink-0', bgColors[trend])}>
              {icon}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground truncate">{title}</p>
              <p className={cn('text-xl font-bold truncate', trendColors[trend])}>
                {formattedValue}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
