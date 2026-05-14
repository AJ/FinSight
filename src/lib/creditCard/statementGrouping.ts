/**
 * Pure computation for StatementHistoryCard.
 *
 * Groups credit card statements by card and sorts by statement date.
 */

export interface StatementLike {
  cardIssuer: string;
  cardLastFour: string;
  statementDate: Date | string;
}

export function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

export function groupStatementsByCard<T extends StatementLike>(
  statements: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const stmt of statements) {
    const key = `${stmt.cardIssuer}-${stmt.cardLastFour}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(stmt);
  }

  for (const [, stmts] of groups) {
    stmts.sort(
      (a, b) => toDate(b.statementDate).getTime() - toDate(a.statementDate).getTime(),
    );
  }

  return groups;
}
