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
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";
import { debugLog } from "@/lib/utils/debug";
import { buildTrendData } from "./trendLineChartData";

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
    const { labels, incomeByPeriod, expensesByPeriod, isWeekly } = buildTrendData(transactions);

    debugLog('TrendLineChart', 'Labels:', labels);
    debugLog('TrendLineChart', 'Income:', incomeByPeriod);
    debugLog('TrendLineChart', 'Expenses:', expensesByPeriod);

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
      isWeekly,
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
        <div className="h-75">
          <Line data={chartData} options={options} />
        </div>
      </CardContent>
    </Card>
  );
}
