/**
 * Pure computation for InternationalSpendingCard.
 *
 * Filters international CC transactions, groups by currency,
 * aggregates amounts, and provides currency symbol lookup.
 */

export interface TransactionLike {
  isInternational: boolean;
  originalCurrency?: { code: string } | null;
  originalAmount?: number;
  amount: number;
  sourceType?: string;
}

export interface CurrencyTotal {
  currency: string;
  originalAmount: number;
  inrAmount: number;
  transactionCount: number;
}

export interface InternationalSummary {
  currencies: CurrencyTotal[];
  totalInr: number;
  totalTxns: number;
}

export function filterInternationalCCTransactions<T extends TransactionLike>(
  transactions: T[],
): T[] {
  return transactions.filter(
    (t) =>
      t.isInternational &&
      t.originalCurrency != null &&
      t.sourceType === "credit_card",
  );
}

export function groupByCurrency<T extends TransactionLike>(
  intlTxns: T[],
): CurrencyTotal[] {
  const currencyMap = new Map<string, CurrencyTotal>();

  for (const txn of intlTxns) {
    const curr = txn.originalCurrency!.code;
    const existing = currencyMap.get(curr);

    if (existing) {
      existing.originalAmount += txn.originalAmount ?? Math.abs(txn.amount);
      existing.inrAmount += Math.abs(txn.amount);
      existing.transactionCount++;
    } else {
      currencyMap.set(curr, {
        currency: curr,
        originalAmount: txn.originalAmount ?? Math.abs(txn.amount),
        inrAmount: Math.abs(txn.amount),
        transactionCount: 1,
      });
    }
  }

  return Array.from(currencyMap.values()).sort(
    (a, b) => b.inrAmount - a.inrAmount,
  );
}

export function computeInternationalSummary<T extends TransactionLike>(
  transactions: T[],
): InternationalSummary | null {
  const intlTxns = filterInternationalCCTransactions(transactions);
  if (intlTxns.length === 0) return null;

  const currencies = groupByCurrency(intlTxns);
  const totalInr = currencies.reduce((sum, c) => sum + c.inrAmount, 0);

  return { currencies, totalInr, totalTxns: intlTxns.length };
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  SGD: "S$",
  AED: "د.إ",
  AUD: "A$",
  CAD: "C$",
  CHF: "Fr",
};

export function getCurrencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] || code;
}
