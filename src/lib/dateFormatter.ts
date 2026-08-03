import { format } from "date-fns";

// Central date display/grouping helpers. Bespoke formatting (chart ticks, relative time) stays
// on date-fns directly; this is the single source for the canonical transaction display format
// and the budget/analytics month-bucketing key.

/** Canonical transaction display: "03 Nov 2025". The month name removes US/UK ambiguity. */
export function formatDate(date: Date): string {
  return format(date, "dd MMM yyyy");
}

/** Month grouping key for budget/forecaster/analytics: "2025-11". */
export function monthKey(date: Date): string {
  return format(date, "yyyy-MM");
}
