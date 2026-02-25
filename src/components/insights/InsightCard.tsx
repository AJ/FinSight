'use client';

import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Insight } from '@/lib/insights/types';
import { getCategoryById, DEFAULT_CATEGORIES } from '@/lib/categorization/categories';
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Lightbulb,
  Calendar,
  Store,
  PiggyBank,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const typeIcons: Record<string, React.ReactNode> = {
  category_trend: <TrendingUp className="w-4 h-4" />,
  day_pattern: <Calendar className="w-4 h-4" />,
  merchant_insight: <Store className="w-4 h-4" />,
  anomaly: <AlertCircle className="w-4 h-4" />,
  budget_alert: <AlertTriangle className="w-4 h-4" />,
  period_comparison: <TrendingDown className="w-4 h-4" />,
  savings_opportunity: <PiggyBank className="w-4 h-4" />,
};

const severityColors: Record<string, { bg: string; text: string; border: string }> = {
  positive: {
    bg: 'bg-success/10',
    text: 'text-success',
    border: 'border-success/20',
  },
  warning: {
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/20',
  },
  info: {
    bg: 'bg-muted/50',
    text: 'text-muted-foreground',
    border: 'border-muted',
  },
};

// List of valid category IDs for quick lookup
const validCategoryIds = new Set(DEFAULT_CATEGORIES.map(c => c.id));

interface InsightCardProps {
  insight: Insight;
  index: number;
}

export function InsightCard({ insight, index }: InsightCardProps) {
  const colors = severityColors[insight.severity] || severityColors.info;
  const icon = typeIcons[insight.type] || <Lightbulb className="w-4 h-4" />;

  // Only show category badge if it's a valid category ID (not an insight type like "day_of_week")
  const isValidCategory = insight.category && validCategoryIds.has(insight.category);
  const categoryInfo = isValidCategory ? getCategoryById(insight.category!) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.1 }}
    >
      <Card className={cn('border', colors.border)}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className={cn('p-2 rounded-lg shrink-0', colors.bg, colors.text)}>
              {icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-medium text-sm truncate">{insight.title}</h4>
                {categoryInfo && (
                  <Badge
                    variant="outline"
                    className="text-xs shrink-0"
                    style={{
                      borderColor: categoryInfo.color,
                      color: categoryInfo.color,
                      backgroundColor: categoryInfo.color ? `${categoryInfo.color}15` : undefined,
                    }}
                  >
                    {categoryInfo.name}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{insight.description}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
