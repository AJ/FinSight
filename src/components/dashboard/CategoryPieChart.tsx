'use client';

import { useMemo } from 'react';
import { Pie } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, TooltipItem } from 'chart.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Transaction, Category, CategoryType } from '@/types';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { formatCurrency } from '@/lib/currencyFormatter';
import { DEFAULT_CATEGORIES } from '@/lib/categorization/categories';

ChartJS.register(ArcElement, Tooltip, Legend);

interface CategoryPieChartProps {
  transactions: Transaction[];
  categories: Category[];
}

// Helper to get category info, falling back to DEFAULT_CATEGORIES
function getCategoryInfo(categoryId: string, userCategories: Category[]): Category {
  // First try user categories
  const userCat = userCategories.find((c) => c.id === categoryId);
  if (userCat) return userCat;

  // Then try default categories
  const defaultCat = DEFAULT_CATEGORIES.find((c) => c.id === categoryId);
  if (defaultCat) return defaultCat;

  // Fallback - create a proper Category instance
  return new Category(
    categoryId,
    categoryId.charAt(0).toUpperCase() + categoryId.slice(1),
    CategoryType.Excluded,
    [],           // keywords
    undefined,    // icon
    '#6b7280',    // color
  );
}

export function CategoryPieChart({ transactions, categories }: CategoryPieChartProps) {
  const currency = useSettingsStore((state) => state.currency);

  const chartData = useMemo(() => {
    const byCategory: Record<string, number> = {};

    // Sum ALL transactions by category (both income and expenses)
    // This gives a complete picture of where money flows
    transactions.forEach((t) => {
      const amount = Math.abs(t.amount);
      const categoryId = t.category?.id || 'uncategorized';
      byCategory[categoryId] = (byCategory[categoryId] || 0) + amount;
    });

    console.log('[CategoryPieChart] By category:', byCategory);

    // Sort by amount and get top categories
    const sortedCategories = Object.entries(byCategory)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8); // Top 8 categories

    console.log('[CategoryPieChart] Sorted:', sortedCategories);

    // Calculate total for percentage
    const total = sortedCategories.reduce((sum, [, amount]) => sum + amount, 0);

    // Build labels, data, and colors with proper category info
    const labels: string[] = [];
    const data: number[] = [];
    const backgroundColors: string[] = [];

    for (const [categoryId, amount] of sortedCategories) {
      const catInfo = getCategoryInfo(categoryId, categories);
      const percentage = ((amount / total) * 100).toFixed(1);

      labels.push(`${catInfo.name} (${percentage}%)`);
      data.push(amount);
      backgroundColors.push(catInfo.color || '#6b7280');
    }

    console.log('[CategoryPieChart] Labels:', labels);
    console.log('[CategoryPieChart] Colors:', backgroundColors);

    return {
      labels,
      datasets: [
        {
          data,
          backgroundColor: backgroundColors,
          borderWidth: 2,
          borderColor: 'rgba(255, 255, 255, 0.8)',
        },
      ],
    };
  }, [transactions, categories]);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right' as const,
        labels: {
          boxWidth: 12,
          padding: 10,
          font: {
            size: 11,
          },
        },
      },
      tooltip: {
        callbacks: {
          label: function (context: TooltipItem<'pie'>) {
            const label = context.label || '';
            const value = context.parsed || 0;
            // Extract just the category name (before the percentage)
            const categoryName = label.split(' (')[0];
            return `${categoryName}: ${formatCurrency(value, currency, false)}`;
          },
        },
      },
    },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spending by Category</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <Pie data={chartData} options={options} />
        </div>
      </CardContent>
    </Card>
  );
}
