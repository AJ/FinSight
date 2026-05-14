import { describe, it, expect } from "vitest";
import {
  classifyUtilization,
  classifyPaymentRate,
  classifyHealthScore,
  getUtilizationStatus,
  getUtilizationTextColor,
  getPaymentRateColor,
  getPaymentRateLabel,
  getHealthScoreColor,
  getHealthScoreLabel,
  getHealthBadgeVariant,
  TIER_TEXT_COLORS,
  TIER_BG_COLORS,
  UTILIZATION_LABELS,
  PAYMENT_RATE_LABELS,
  HEALTH_SCORE_LABELS,
  type Tier,
} from "@/lib/creditCard/creditCardClassification";

describe("Tier infrastructure", () => {
  it("has exactly 4 tiers", () => {
    expect(TIER_TEXT_COLORS).toHaveProperty("excellent");
    expect(TIER_TEXT_COLORS).toHaveProperty("good");
    expect(TIER_TEXT_COLORS).toHaveProperty("fair");
    expect(TIER_TEXT_COLORS).toHaveProperty("poor");
  });

  it("has consistent keys across all record maps", () => {
    const expected: Tier[] = ["excellent", "good", "fair", "poor"];
    for (const key of expected) {
      expect(TIER_TEXT_COLORS[key]).toBeDefined();
      expect(TIER_BG_COLORS[key]).toBeDefined();
      expect(UTILIZATION_LABELS[key]).toBeDefined();
      expect(PAYMENT_RATE_LABELS[key]).toBeDefined();
      expect(HEALTH_SCORE_LABELS[key]).toBeDefined();
    }
  });
});

describe("classifyUtilization", () => {
  it("returns excellent for < 10%", () => {
    expect(classifyUtilization(0)).toBe("excellent");
    expect(classifyUtilization(0.05)).toBe("excellent");
    expect(classifyUtilization(0.099)).toBe("excellent");
  });

  it("returns good for 10-29%", () => {
    expect(classifyUtilization(0.10)).toBe("good");
    expect(classifyUtilization(0.20)).toBe("good");
    expect(classifyUtilization(0.299)).toBe("good");
  });

  it("returns fair for 30-49%", () => {
    expect(classifyUtilization(0.30)).toBe("fair");
    expect(classifyUtilization(0.40)).toBe("fair");
    expect(classifyUtilization(0.499)).toBe("fair");
  });

  it("returns poor for >= 50%", () => {
    expect(classifyUtilization(0.50)).toBe("poor");
    expect(classifyUtilization(0.75)).toBe("poor");
    expect(classifyUtilization(1.0)).toBe("poor");
  });

  it("handles edge case: exactly 0", () => {
    expect(classifyUtilization(0)).toBe("excellent");
  });
});

describe("getUtilizationStatus", () => {
  it("returns full status object for excellent tier", () => {
    const status = getUtilizationStatus(0.05);
    expect(status.tier).toBe("excellent");
    expect(status.label).toBe("Excellent");
    expect(status.bgColor).toBe(TIER_BG_COLORS.excellent);
    expect(status.textColor).toBe(TIER_TEXT_COLORS.excellent);
  });

  it("returns High label for poor tier", () => {
    const status = getUtilizationStatus(0.6);
    expect(status.label).toBe("High");
  });

  it("returns correct textColor for each tier", () => {
    expect(getUtilizationStatus(0.05).textColor).toBe("text-success");
    expect(getUtilizationStatus(0.20).textColor).toBe("text-blue-500");
    expect(getUtilizationStatus(0.40).textColor).toBe("text-amber-500");
    expect(getUtilizationStatus(0.60).textColor).toBe("text-destructive");
  });
});

describe("getUtilizationTextColor", () => {
  it("returns success for < 30%", () => {
    expect(getUtilizationTextColor(0)).toBe("text-success");
    expect(getUtilizationTextColor(0.29)).toBe("text-success");
  });

  it("returns amber for 30-49%", () => {
    expect(getUtilizationTextColor(0.30)).toBe("text-amber-600");
    expect(getUtilizationTextColor(0.49)).toBe("text-amber-600");
  });

  it("returns destructive for >= 50%", () => {
    expect(getUtilizationTextColor(0.50)).toBe("text-destructive");
    expect(getUtilizationTextColor(1.0)).toBe("text-destructive");
  });
});

describe("classifyPaymentRate", () => {
  it("returns excellent for >= 90%", () => {
    expect(classifyPaymentRate(0.9)).toBe("excellent");
    expect(classifyPaymentRate(1.0)).toBe("excellent");
  });

  it("returns good for 70-89%", () => {
    expect(classifyPaymentRate(0.7)).toBe("good");
    expect(classifyPaymentRate(0.8)).toBe("good");
    expect(classifyPaymentRate(0.899)).toBe("good");
  });

  it("returns fair for 50-69%", () => {
    expect(classifyPaymentRate(0.5)).toBe("fair");
    expect(classifyPaymentRate(0.6)).toBe("fair");
    expect(classifyPaymentRate(0.699)).toBe("fair");
  });

  it("returns poor for < 50%", () => {
    expect(classifyPaymentRate(0)).toBe("poor");
    expect(classifyPaymentRate(0.49)).toBe("poor");
  });
});

describe("getPaymentRateColor", () => {
  it("returns correct color for each tier", () => {
    expect(getPaymentRateColor(0.95)).toBe("text-success");
    expect(getPaymentRateColor(0.75)).toBe("text-blue-500");
    expect(getPaymentRateColor(0.55)).toBe("text-amber-500");
    expect(getPaymentRateColor(0.3)).toBe("text-destructive");
  });
});

describe("getPaymentRateLabel", () => {
  it("returns Needs Improvement for poor tier", () => {
    expect(getPaymentRateLabel(0.3)).toBe("Needs Improvement");
  });

  it("returns Excellent for excellent tier", () => {
    expect(getPaymentRateLabel(0.95)).toBe("Excellent");
  });
});

describe("classifyHealthScore", () => {
  it("returns excellent for >= 80", () => {
    expect(classifyHealthScore(80)).toBe("excellent");
    expect(classifyHealthScore(100)).toBe("excellent");
  });

  it("returns good for 60-79", () => {
    expect(classifyHealthScore(60)).toBe("good");
    expect(classifyHealthScore(79)).toBe("good");
  });

  it("returns fair for 40-59", () => {
    expect(classifyHealthScore(40)).toBe("fair");
    expect(classifyHealthScore(59)).toBe("fair");
  });

  it("returns poor for < 40", () => {
    expect(classifyHealthScore(0)).toBe("poor");
    expect(classifyHealthScore(39)).toBe("poor");
  });
});

describe("getHealthScoreColor", () => {
  it("returns correct color for each tier", () => {
    expect(getHealthScoreColor(90)).toBe("text-success");
    expect(getHealthScoreColor(70)).toBe("text-blue-500");
    expect(getHealthScoreColor(50)).toBe("text-amber-500");
    expect(getHealthScoreColor(20)).toBe("text-destructive");
  });
});

describe("getHealthScoreLabel", () => {
  it("returns Needs Work for poor tier", () => {
    expect(getHealthScoreLabel(20)).toBe("Needs Work");
  });

  it("returns correct labels for each tier", () => {
    expect(getHealthScoreLabel(85)).toBe("Excellent");
    expect(getHealthScoreLabel(65)).toBe("Good");
    expect(getHealthScoreLabel(45)).toBe("Fair");
    expect(getHealthScoreLabel(20)).toBe("Needs Work");
  });
});

describe("getHealthBadgeVariant", () => {
  it("returns correct badge variant for each tier", () => {
    expect(getHealthBadgeVariant(90)).toBe("default");
    expect(getHealthBadgeVariant(70)).toBe("secondary");
    expect(getHealthBadgeVariant(50)).toBe("outline");
    expect(getHealthBadgeVariant(20)).toBe("destructive");
  });

  it("returns exact type match for all variants", () => {
    const variants = new Set(["default", "secondary", "outline", "destructive"]);
    expect(variants.has(getHealthBadgeVariant(0))).toBe(true);
    expect(variants.has(getHealthBadgeVariant(50))).toBe(true);
    expect(variants.has(getHealthBadgeVariant(100))).toBe(true);
  });
});
