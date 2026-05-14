import { describe, it, expect } from "vitest";
import {
  filterInternationalCCTransactions,
  groupByCurrency,
  computeInternationalSummary,
  getCurrencySymbol,
  type TransactionLike,
} from "@/components/creditCard/internationalSpendingCalculation";

function makeTxn(overrides: Partial<TransactionLike> & { amount: number }): TransactionLike {
  return {
    isInternational: false,
    originalCurrency: null,
    sourceType: "credit_card",
    ...overrides,
  };
}

describe("filterInternationalCCTransactions", () => {
  it("returns only international CC transactions", () => {
    const txns = [
      makeTxn({ amount: 100, isInternational: true, originalCurrency: { code: "USD" }, sourceType: "credit_card" }),
      makeTxn({ amount: 200, isInternational: false, sourceType: "credit_card" }),
      makeTxn({ amount: 300, isInternational: true, originalCurrency: { code: "EUR" }, sourceType: "bank" }),
      makeTxn({ amount: 400, isInternational: true, sourceType: "credit_card" }), // no originalCurrency
    ];

    const result = filterInternationalCCTransactions(txns);
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(100);
  });

  it("returns empty for no international txns", () => {
    const txns = [
      makeTxn({ amount: 100, sourceType: "credit_card" }),
      makeTxn({ amount: 200, sourceType: "bank" }),
    ];
    expect(filterInternationalCCTransactions(txns)).toHaveLength(0);
  });

  it("returns empty for empty input", () => {
    expect(filterInternationalCCTransactions([])).toHaveLength(0);
  });

  it("excludes transactions with null originalCurrency", () => {
    const txns = [
      makeTxn({ amount: 100, isInternational: true, originalCurrency: null, sourceType: "credit_card" }),
    ];
    expect(filterInternationalCCTransactions(txns)).toHaveLength(0);
  });
});

describe("groupByCurrency", () => {
  it("groups transactions by currency code", () => {
    const txns = [
      makeTxn({ amount: 500, originalCurrency: { code: "USD" } }),
      makeTxn({ amount: 300, originalCurrency: { code: "USD" } }),
      makeTxn({ amount: 800, originalCurrency: { code: "EUR" } }),
    ];

    const result = groupByCurrency(txns);
    expect(result).toHaveLength(2);
    const usd = result.find((c) => c.currency === "USD")!;
    expect(usd.transactionCount).toBe(2);
    expect(usd.inrAmount).toBe(800); // 500 + 300

    const eur = result.find((c) => c.currency === "EUR")!;
    expect(eur.transactionCount).toBe(1);
    expect(eur.inrAmount).toBe(800);
  });

  it("uses originalAmount when present, falling back to abs(amount)", () => {
    const txns = [
      makeTxn({ amount: 500, originalAmount: 60, originalCurrency: { code: "USD" } }),
      makeTxn({ amount: 300, originalCurrency: { code: "USD" } }), // no originalAmount
    ];

    const result = groupByCurrency(txns);
    const usd = result[0];
    expect(usd.originalAmount).toBe(360); // 60 + 300 (fallback to abs(amount))
  });

  it("preserves originalAmount of 0 (does not treat as missing)", () => {
    const txns = [
      makeTxn({ amount: 500, originalAmount: 0, originalCurrency: { code: "USD" } }),
    ];

    const result = groupByCurrency(txns);
    expect(result[0].originalAmount).toBe(0);
  });

  it("sorts currencies by inrAmount descending", () => {
    const txns = [
      makeTxn({ amount: 100, originalCurrency: { code: "USD" } }),
      makeTxn({ amount: 500, originalCurrency: { code: "EUR" } }),
      makeTxn({ amount: 200, originalCurrency: { code: "GBP" } }),
    ];

    const result = groupByCurrency(txns);
    expect(result.map((c) => c.currency)).toEqual(["EUR", "GBP", "USD"]);
  });

  it("handles empty input", () => {
    expect(groupByCurrency([])).toHaveLength(0);
  });
});

describe("computeInternationalSummary", () => {
  it("returns null for no international CC transactions", () => {
    expect(computeInternationalSummary([])).toBeNull();
    expect(
      computeInternationalSummary([
        makeTxn({ amount: 100, isInternational: false, sourceType: "credit_card" }),
      ]),
    ).toBeNull();
  });

  it("computes full summary for multiple currencies", () => {
    const txns = [
      makeTxn({
        amount: 500,
        isInternational: true,
        originalCurrency: { code: "USD" },
        originalAmount: 60,
        sourceType: "credit_card",
      }),
      makeTxn({
        amount: 800,
        isInternational: true,
        originalCurrency: { code: "EUR" },
        originalAmount: 700,
        sourceType: "credit_card",
      }),
    ];

    const summary = computeInternationalSummary(txns);
    expect(summary).not.toBeNull();
    expect(summary!.currencies).toHaveLength(2);
    expect(summary!.totalInr).toBe(1300);
    expect(summary!.totalTxns).toBe(2);
  });

  it("aggregates same currency across multiple transactions", () => {
    const txns = [
      makeTxn({ amount: 100, isInternational: true, originalCurrency: { code: "USD" }, sourceType: "credit_card" }),
      makeTxn({ amount: 200, isInternational: true, originalCurrency: { code: "USD" }, sourceType: "credit_card" }),
    ];

    const summary = computeInternationalSummary(txns);
    expect(summary!.currencies).toHaveLength(1);
    expect(summary!.currencies[0].inrAmount).toBe(300);
    expect(summary!.currencies[0].transactionCount).toBe(2);
  });
});

describe("getCurrencySymbol", () => {
  it("returns known symbols", () => {
    expect(getCurrencySymbol("USD")).toBe("$");
    expect(getCurrencySymbol("EUR")).toBe("€");
    expect(getCurrencySymbol("GBP")).toBe("£");
    expect(getCurrencySymbol("JPY")).toBe("¥");
    expect(getCurrencySymbol("SGD")).toBe("S$");
    expect(getCurrencySymbol("AED")).toBe("د.إ");
    expect(getCurrencySymbol("AUD")).toBe("A$");
    expect(getCurrencySymbol("CAD")).toBe("C$");
    expect(getCurrencySymbol("CHF")).toBe("Fr");
  });

  it("returns currency code for unknown symbols", () => {
    expect(getCurrencySymbol("INR")).toBe("INR");
    expect(getCurrencySymbol("XYZ")).toBe("XYZ");
  });
});
