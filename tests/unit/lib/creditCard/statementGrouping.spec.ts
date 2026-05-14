import { describe, it, expect } from "vitest";
import { toDate, groupStatementsByCard, type StatementLike } from "@/lib/creditCard/statementGrouping";

function makeStmt(overrides: Partial<StatementLike> & { cardIssuer: string; cardLastFour: string }): StatementLike {
  return {
    statementDate: new Date("2024-01-15"),
    ...overrides,
  };
}

describe("toDate", () => {
  it("returns Date as-is", () => {
    const d = new Date("2024-06-01");
    expect(toDate(d)).toBe(d);
  });

  it("parses ISO string to Date", () => {
    const result = toDate("2024-06-01T00:00:00.000Z");
    expect(result).toBeInstanceOf(Date);
    expect(result.getFullYear()).toBe(2024);
  });

  it("parses date-only string", () => {
    const result = toDate("2024-06-01");
    expect(result).toBeInstanceOf(Date);
    expect(result.getMonth()).toBe(5); // June
  });
});

describe("groupStatementsByCard", () => {
  it("groups statements by card key", () => {
    const stmts = [
      makeStmt({ cardIssuer: "HDFC", cardLastFour: "1234" }),
      makeStmt({ cardIssuer: "HDFC", cardLastFour: "5678" }),
      makeStmt({ cardIssuer: "HDFC", cardLastFour: "1234" }),
    ];

    const groups = groupStatementsByCard(stmts);
    expect(groups.size).toBe(2);
    expect(groups.get("HDFC-1234")).toHaveLength(2);
    expect(groups.get("HDFC-5678")).toHaveLength(1);
  });

  it("sorts each group by statement date descending", () => {
    const stmts = [
      makeStmt({ cardIssuer: "Visa", cardLastFour: "1111", statementDate: new Date("2024-01-15") }),
      makeStmt({ cardIssuer: "Visa", cardLastFour: "1111", statementDate: new Date("2024-03-20") }),
      makeStmt({ cardIssuer: "Visa", cardLastFour: "1111", statementDate: new Date("2024-02-10") }),
    ];

    const groups = groupStatementsByCard(stmts);
    const sorted = groups.get("Visa-1111")!;
    expect(sorted[0].statementDate).toEqual(new Date("2024-03-20"));
    expect(sorted[1].statementDate).toEqual(new Date("2024-02-10"));
    expect(sorted[2].statementDate).toEqual(new Date("2024-01-15"));
  });

  it("handles string dates via toDate conversion", () => {
    const stmts = [
      makeStmt({ cardIssuer: "MC", cardLastFour: "9999", statementDate: "2024-01-01" }),
      makeStmt({ cardIssuer: "MC", cardLastFour: "9999", statementDate: "2024-06-01" }),
    ];

    const groups = groupStatementsByCard(stmts);
    const sorted = groups.get("MC-9999")!;
    // June should come before January (descending)
    const firstDate = toDate(sorted[0].statementDate);
    expect(firstDate.getMonth()).toBe(5); // June
  });

  it("returns empty map for empty input", () => {
    const groups = groupStatementsByCard([]);
    expect(groups.size).toBe(0);
  });

  it("creates separate groups for different cards", () => {
    const stmts = [
      makeStmt({ cardIssuer: "Amex", cardLastFour: "0001" }),
      makeStmt({ cardIssuer: "Visa", cardLastFour: "0002" }),
      makeStmt({ cardIssuer: "Amex", cardLastFour: "0001" }),
    ];

    const groups = groupStatementsByCard(stmts);
    expect(groups.size).toBe(2);
    expect(groups.get("Amex-0001")).toHaveLength(2);
    expect(groups.get("Visa-0002")).toHaveLength(1);
  });
});
