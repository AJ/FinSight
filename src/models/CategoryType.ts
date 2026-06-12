/**
 * Economic type of a category for routing and aggregation.
 * Each type maps directly to a routing bucket — no separate override needed.
 */
export enum CategoryType {
  Income = "income",
  Expense = "expense",
  DebtPayment = "debt",
  Investment = "investment",
  Excluded = "excluded",
}
