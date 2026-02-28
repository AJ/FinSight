"use client";

import { useMemo } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  TooltipItem,
} from "chart.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Transaction } from "@/types";
import { format, startOfMonth, startOfWeek, endOfWeek, differenceInWeeks, addWeeks } from "date-fns";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

interface TrendLineChartProps {
  transactions: Transaction[];
}

export function TrendLineChart({ transactions }: TrendLineChartProps) {
  const currency = useSettingsStore((state) => state.currency);

  const chartData = useMemo(() => {
    if (transactions.length === 0) {
      console.log("[TrendLineChart] No transactions");
      return { labels: [], datasets: [], isWeekly: false };
    }

    // Ensure dates are proper Date objects
    const transactionsWithDates = transactions.map((t) => ({
      ...t,
      dateObj: t.date instanceof Date ? t.date : new Date(t.date),
    })).filter((t) => !isNaN(t.dateObj.getTime()));

    if (transactionsWithDates.length === 0) {
      console.log("[TrendLineChart] No valid dates");
      return { labels: [], datasets: [], isWeekly: false };
    }

    // Sort by date
    transactionsWithDates.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());

    const firstDate = transactionsWithDates[0].dateObj;
    const lastDate = transactionsWithDates[transactionsWithDates.length - 1].dateObj;

    // Calculate number of weeks in the data range
    const numWeeks = differenceInWeeks(lastDate, firstDate) + 1;
    const useWeekly = numWeeks <= 7;

    console.log("[TrendLineChart] Date range weeks:", numWeeks, "Using weekly:", useWeekly);

    let labels: string[] = [];
    const incomeByPeriod: number[] = [];
    const expensesByPeriod: number[] = [];

    if (useWeekly) {
      // Group by week
      const periods: { start: Date; end: Date; label: string }[] = [];
      let current = startOfWeek(firstDate, { weekStartsOn: 1 }); // Monday
      const end = startOfWeek(lastDate, { weekStartsOn: 1 });

      while (current <= end) {
        const weekEnd = endOfWeek(current, { weekStartsOn: 1 });
        periods.push({
          start: current,
          end: weekEnd,
          label: format(current, "MMM d"),
        });
        current = addWeeks(current, 1);
      }

      labels = periods.map((p) => p.label);

      periods.forEach((period) => {
        const periodTransactions = transactionsWithDates.filter((t) => {
          return t.dateObj >= period.start && t.dateObj <= period.end;
        });

        const income = periodTransactions
          .filter((t) => t.category?.isIncome)
          .reduce((sum, t) => sum + Math.abs(t.amount), 0);

        const expenses = periodTransactions
          .filter((t) => t.category?.isExpense)
          .reduce((sum, t) => sum + Math.abs(t.amount), 0);

        incomeByPeriod.push(income);
        expensesByPeriod.push(expenses);
      });
    } else {
      // Group by month (existing logic)
      const firstMonth = startOfMonth(firstDate);
      const lastMonth = startOfMonth(lastDate);

      const months: Date[] = [];
      let current = firstMonth;
      while (current <= lastMonth) {
        months.push(new Date(current));
        current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
      }

      // Cap at 12 months for readability
      const displayMonths = months.length > 12 ? months.slice(-12) : months;

      labels = displayMonths.map((month) => format(month, "MMM yyyy"));

      displayMonths.forEach((month) => {
        const monthEnd = new Date(
          month.getFullYear(),
          month.getMonth() + 1,
          0,
          23,
          59,
          59,
        );

        const monthTransactions = transactionsWithDates.filter((t) => {
          return t.dateObj >= month && t.dateObj <= monthEnd;
        });

        const income = monthTransactions
          .filter((t) => t.category?.isIncome)
          .reduce((sum, t) => sum + Math.abs(t.amount), 0);

        const expenses = monthTransactions
          .filter((t) => t.category?.isExpense)
          .reduce((sum, t) => sum + Math.abs(t.amount), 0);

        incomeByPeriod.push(income);
        expensesByPeriod.push(expenses);
      });
    }

    console.log("[TrendLineChart] Labels:", labels);
    console.log("[TrendLineChart] Income:", incomeByPeriod);
    console.log("[TrendLineChart] Expenses:", expensesByPeriod);

    return {
      labels,
      datasets: [
        {
          label: "Income",
          data: incomeByPeriod,
          borderColor: "#10b981",
          backgroundColor: "rgba(16, 185, 129, 0.15)",
          fill: true,
          tension: 0.2,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: "#10b981",
          pointBorderColor: "#fff",
          pointBorderWidth: 1,
          borderWidth: 2,
        },
        {
          label: "Expenses",
          data: expensesByPeriod,
          borderColor: "#ef4444",
          backgroundColor: "rgba(239, 68, 68, 0.15)",
          fill: true,
          tension: 0.2,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: "#ef4444",
          pointBorderColor: "#fff",
          pointBorderWidth: 2,
          borderWidth: 2,
        },
      ],
      isWeekly: useWeekly,
    };
  }, [transactions]);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top" as const,
        labels: {
          usePointStyle: true,
          pointStyle: "circle",
        },
      },
      tooltip: {
        callbacks: {
          label: function (context: TooltipItem<'line'>) {
            const label = context.dataset.label || "";
            const value = context.parsed.y || 0;
            return `${label}: ${formatCurrency(value, currency, false)}`;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: {
          color: "rgba(0, 0, 0, 0.05)",
        },
        ticks: {
          callback: (value: number | string) => {
            return formatCurrency(Number(value), currency, false);
          },
        },
      },
      x: {
        grid: {
          display: false,
        },
      },
    },
  };

  const title = chartData.isWeekly
    ? "Weekly Income vs Expenses"
    : "Monthly Income vs Expenses";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <Line data={chartData} options={options} />
        </div>
      </CardContent>
    </Card>
  );
}
