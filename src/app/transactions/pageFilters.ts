// Pure filter / count / selection helpers for the Transactions page.
//
// Extracted verbatim from the page component so the filter logic can be unit-tested as
// pure functions (no React, no store, no mocks). The component maps its state onto
// FilterState and calls these; behavior is unchanged.

import type { Transaction } from "@/types";
import { needsAttention } from "@/lib/review/reviewReasons";

export type TypeFilter = "all" | "income" | "expense" | "transfer";
export type SourceFilter = "all" | "bank" | "credit_card";

export interface FilterState {
  search: string;
  category: string; // "all" or a category id
  type: TypeFilter;
  source: SourceFilter;
  anomalyOnly: boolean;
  needsReviewOnly: boolean;
}

/**
 * Apply every active filter, then sort newest-first by date. Empty search matches all
 * (substring "" is contained in every description). Invalid date strings fall back to the
 * epoch so they sort last instead of crashing.
 */
export function applyFilters(
  transactions: Transaction[],
  filters: FilterState,
): Transaction[] {
  const search = filters.search.toLowerCase();
  return transactions
    .filter((t) => {
      const matchesSearch = t.description.toLowerCase().includes(search);
      const matchesCategory =
        filters.category === "all" || t.category.id === filters.category;
      const matchesType =
        filters.type === "all" ||
        (filters.type === "income" && t.isIncome) ||
        (filters.type === "expense" && t.isExpense) ||
        (filters.type === "transfer" && t.isExcluded);
      const matchesSource =
        filters.source === "all" || t.sourceType === filters.source;
      const matchesAnomaly =
        !filters.anomalyOnly || (t.isAnomaly && !t.anomalyDismissed);
      const matchesNeedsReview =
        !filters.needsReviewOnly || needsAttention(t.reviewReasons);

      return (
        matchesSearch &&
        matchesCategory &&
        matchesType &&
        matchesSource &&
        matchesAnomaly &&
        matchesNeedsReview
      );
    })
    .sort((a, b) => {
      const dateA = a.date instanceof Date ? a.date : new Date(a.date);
      const dateB = b.date instanceof Date ? b.date : new Date(b.date);
      return dateB.getTime() - dateA.getTime();
    });
}

/** Active (non-dismissed) anomalies — drives the anomaly filter button visibility and count. */
export function activeAnomalyCount(transactions: Transaction[]): number {
  return transactions.filter((t) => t.isAnomaly && !t.anomalyDismissed).length;
}

/** True when any filter is off its default — drives the "Clear" button visibility. */
export function hasFilters(filters: FilterState): boolean {
  return (
    Boolean(filters.search) ||
    filters.category !== "all" ||
    filters.type !== "all" ||
    filters.source !== "all" ||
    filters.anomalyOnly ||
    filters.needsReviewOnly
  );
}

/** True only when there are visible rows and every one is selected. */
export function isAllSelected(
  filtered: Transaction[],
  selectedIds: string[],
): boolean {
  return (
    filtered.length > 0 && filtered.every((t) => selectedIds.includes(t.id))
  );
}

/** The default filter state — no filters active. */
export const NO_FILTERS: FilterState = {
  search: "",
  category: "all",
  type: "all",
  source: "all",
  anomalyOnly: false,
  needsReviewOnly: false,
};
