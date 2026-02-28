/**
 * Economic type of a category for aggregation purposes.
 * - Income: Money received (salary, cashback, interest earned)
 * - Expense: Money spent (groceries, dining, bills)
 * - Excluded: Asset transfers that don't affect income/expense totals (transfers, investments)
 */
export enum CategoryType {
  Income = "income",
  Expense = "expense",
  Excluded = "excluded",
}
