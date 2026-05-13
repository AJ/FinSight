export interface TransactionLike {
  sourceType?: string;
  isIncome: boolean;
  isExpense: boolean;
  amount: number;
}

export interface TrueBalanceResult {
  bankIncome: number;
  bankExpenses: number;
  bankBalance: number;
  ccOutstanding: number;
  trueBalance: number;
}

export function computeTrueBalance(
  transactions: TransactionLike[],
  ccOutstanding: number,
): TrueBalanceResult {
  const bankIncome = transactions
    .filter((t) => t.sourceType !== "credit_card" && t.isIncome)
    .reduce((sum, t) => sum + t.amount, 0);

  const bankExpenses = transactions
    .filter((t) => t.sourceType !== "credit_card" && t.isExpense)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const bankBalance = bankIncome - bankExpenses;

  return {
    bankIncome,
    bankExpenses,
    bankBalance,
    ccOutstanding,
    trueBalance: bankBalance - ccOutstanding,
  };
}
