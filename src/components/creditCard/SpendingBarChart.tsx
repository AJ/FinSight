"use client";

import { useMemo } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
} from "chart.js";
import { GroupedSpending } from "@/lib/creditCard/dimensionalAnalysis";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface SpendingBarChartProps {
  data: GroupedSpending[];
  title?: string;
  horizontal?: boolean;
  showPercentage?: boolean;
  maxItems?: number;
}

/**
 * Spending Bar Chart
 *
 * Displays spending distribution as a bar chart.
 */
export function SpendingBarChart({
  data,
  title,
  horizontal = false,
  showPercentage = false,
  maxItems = 10,
}: SpendingBarChartProps) {
  const currency = useSettingsStore((state) => state.currency);

  const displayData = useMemo(() => {
    return data.slice(0, maxItems);
  }, [data, maxItems]);

  const chartData = useMemo(() => {
    return {
      labels: displayData.map((d) =>
        d.label.length > 20 ? d.label.substring(0, 20) + "..." : d.label
      ),
      datasets: [
        {
          label: "Spending",
          data: displayData.map((d) => (showPercentage ? d.percentage : d.amount)),
          backgroundColor: displayData.map((d) => d.color || "#6b7280"),
          borderColor: displayData.map((d) => d.color || "#6b7280"),
          borderWidth: 0,
          borderRadius: 4,
        },
      ],
    };
  }, [displayData, showPercentage]);

  const options: ChartOptions<"bar"> = useMemo(() => {
    return {
      indexAxis: horizontal ? "y" : "x",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        title: {
          display: !!title,
          text: title,
          font: {
            size: 14,
          },
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const item = displayData[context.dataIndex];
              if (!item) return "";
              if (showPercentage) {
                return ` ${item.percentage.toFixed(1)}% (${formatCurrency(item.amount, currency)})`;
              }
              return ` ${formatCurrency(item.amount, currency)} (${item.percentage.toFixed(1)}%)`;
            },
          },
        },
      },
      scales: {
        x: {
          display: !horizontal,
          grid: {
            display: false,
          },
          ticks: {
            maxRotation: 45,
            minRotation: 45,
            font: {
              size: 10,
            },
          },
        },
        y: {
          display: horizontal,
          grid: {
            display: false,
          },
          ticks: {
            callback: (value) => {
              if (showPercentage) {
                return `${value}%`;
              }
              return formatCurrency(value as number, currency);
            },
            font: {
              size: 10,
            },
          },
        },
      },
    };
  }, [horizontal, title, showPercentage, currency, displayData]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground">
        No data to display
      </div>
    );
  }

  return (
    <div className="h-[300px]">
      <Bar data={chartData} options={options} />
    </div>
  );
}
