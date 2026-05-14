/**
 * Tiered classification for credit card health metrics.
 *
 * Three domains share the same 4-tier pattern (Excellent/Good/Fair/Poor)
 * but differ in thresholds and labels. Each domain gets its own classify
 * function, while sharing the Tier type and color infrastructure.
 */

export type Tier = "excellent" | "good" | "fair" | "poor";

export const TIER_TEXT_COLORS: Record<Tier, string> = {
  excellent: "text-success",
  good: "text-blue-500",
  fair: "text-amber-500",
  poor: "text-destructive",
};

export const TIER_BG_COLORS: Record<Tier, string> = {
  excellent: "bg-success",
  good: "bg-blue-500",
  fair: "bg-amber-500",
  poor: "bg-destructive",
};

// ── Utilization (lower is better) ──────────────────────────────

export function classifyUtilization(util: number): Tier {
  if (util < 0.1) return "excellent";
  if (util < 0.3) return "good";
  if (util < 0.5) return "fair";
  return "poor";
}

export const UTILIZATION_LABELS: Record<Tier, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  poor: "High",
};

export interface UtilizationStatus {
  tier: Tier;
  label: string;
  bgColor: string;
  textColor: string;
}

export function getUtilizationStatus(util: number): UtilizationStatus {
  const tier = classifyUtilization(util);
  return {
    tier,
    label: UTILIZATION_LABELS[tier],
    bgColor: TIER_BG_COLORS[tier],
    textColor: TIER_TEXT_COLORS[tier],
  };
}

/** Simplified 3-tier color for inline display (CardComparisonTable, etc.). */
export function getUtilizationTextColor(util: number): string {
  if (util < 0.3) return "text-success";
  if (util < 0.5) return "text-amber-600";
  return "text-destructive";
}

// ── Payment rate (higher is better) ────────────────────────────

export function classifyPaymentRate(rate: number): Tier {
  if (rate >= 0.9) return "excellent";
  if (rate >= 0.7) return "good";
  if (rate >= 0.5) return "fair";
  return "poor";
}

export const PAYMENT_RATE_LABELS: Record<Tier, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  poor: "Needs Improvement",
};

export function getPaymentRateColor(rate: number): string {
  return TIER_TEXT_COLORS[classifyPaymentRate(rate)];
}

export function getPaymentRateLabel(rate: number): string {
  return PAYMENT_RATE_LABELS[classifyPaymentRate(rate)];
}

// ── Health score (higher is better) ────────────────────────────

export function classifyHealthScore(score: number): Tier {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "fair";
  return "poor";
}

export const HEALTH_SCORE_LABELS: Record<Tier, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  poor: "Needs Work",
};

export function getHealthScoreColor(score: number): string {
  return TIER_TEXT_COLORS[classifyHealthScore(score)];
}

export function getHealthScoreLabel(score: number): string {
  return HEALTH_SCORE_LABELS[classifyHealthScore(score)];
}

export function getHealthBadgeVariant(
  score: number,
): "default" | "secondary" | "outline" | "destructive" {
  const tier = classifyHealthScore(score);
  switch (tier) {
    case "excellent":
      return "default";
    case "good":
      return "secondary";
    case "fair":
      return "outline";
    case "poor":
      return "destructive";
  }
}
