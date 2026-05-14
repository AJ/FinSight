import { describe, it, expect } from "vitest";
import { formatPoints } from "@/lib/creditCard/rewardFormatting";

describe("formatPoints", () => {
  it("formats millions with one decimal", () => {
    expect(formatPoints(1_000_000)).toBe("1.0M");
    expect(formatPoints(2_500_000)).toBe("2.5M");
    expect(formatPoints(15_000_000)).toBe("15.0M");
  });

  it("formats thousands with one decimal", () => {
    expect(formatPoints(1_000)).toBe("1.0K");
    expect(formatPoints(1_500)).toBe("1.5K");
    expect(formatPoints(999_999)).toBe("1000.0K");
  });

  it("formats small numbers with locale string", () => {
    expect(formatPoints(0)).toBe("0");
    expect(formatPoints(500)).toBe("500");
    expect(formatPoints(999)).toBe("999");
  });

  it("handles exactly 1000 as K", () => {
    expect(formatPoints(1000)).toBe("1.0K");
  });

  it("handles exactly 1000000 as M", () => {
    expect(formatPoints(1_000_000)).toBe("1.0M");
  });
});
