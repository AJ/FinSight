"use client";

import { useMemo } from "react";
import { Pie, Doughnut } from "react-chartjs-2";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  ChartOptions,
} from "chart.js";
import { GroupedSpending } from "@/lib/creditCard/dimensionalAnalysis";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";

ChartJS.register(ArcElement, Tooltip, Legend);

interface SpendingPieChartProps {
  data: GroupedSpending[];
  title?: string;
  showLegend?: boolean;
  doughnut?: boolean;
}

/**
 * Spending Pie/Doughnut Chart
 *
 * Displays spending distribution as a pie or doughnut chart.
 */
export function SpendingPieChart({
  data,
  title,
  showLegend = true,
  doughnut = false,
}: SpendingPieChartProps) {
  const currency = useSettingsStore((state) => state.currency);

  const chartData = useMemo(() => {
    return {
      labels: data.map((d) => d.label),
      datasets: [
        {
          data: data.map((d) => d.amount),
          backgroundColor: data.map((d) => d.color || "#6b7280"),
          borderColor: "#ffffff",
          borderWidth: 2,
        },
      ],
    };
  }, [data]);

  const options: ChartOptions<"pie" | "doughnut"> = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: showLegend,
          position: "right" as const,
          labels: {
            boxWidth: 12,
            padding: 8,
            font: {
              size: 11,
            },
          },
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const item = data[context.dataIndex];
              if (!item) return "";
              return ` ${formatCurrency(item.amount, currency)} (${item.percentage.toFixed(1)}%)`;
            },
          },
        },
      },
    };
  }, [data, currency, showLegend]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground">
        No data to display
      </div>
    );
  }

  const ChartComponent = doughnut ? Doughnut : Pie;

  return (
    <div className="space-y-2">
      {title && (
        <h4 className="text-sm font-medium text-center">{title}</h4>
      )}
      <div className="h-[250px]">
        <ChartComponent data={chartData} options={options} />
      </div>
    </div>
  );
}
