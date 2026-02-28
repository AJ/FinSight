/**
 * Direction of money flow from the account perspective.
 * - Credit: Money coming into the account (deposits, refunds, payments received)
 * - Debit: Money going out of the account (purchases, withdrawals, fees)
 */
export enum TransactionType {
  Credit = "credit",
  Debit = "debit",
}
