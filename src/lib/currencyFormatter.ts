import { Currency } from "@/types";
import { getLocaleForCurrency, getCurrencyByCode } from "@/lib/parsers/currencyDetector";

// Re-export for convenience
export { getCurrencyByCode };

export function formatCurrency(
  amount: number,
  currency: Currency,
  showSign: boolean = true,
): string {
  const absAmount = Math.abs(amount);
  const locale = getLocaleForCurrency(currency.code);

  // For whole numbers, don't show decimals (except JPY/KRW which never have decimals)
  const noDecimalCurrencies = ["JPY", "KRW", "VND", "IDR", "CLP"];
  const forceNoDecimals = noDecimalCurrencies.includes(currency.code);
  const hasDecimals = !forceNoDecimals && absAmount % 1 !== 0;

  let formatted: string;
  try {
    formatted = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency.code,
      minimumFractionDigits: forceNoDecimals ? 0 : hasDecimals ? 2 : 0,
      maximumFractionDigits: forceNoDecimals ? 0 : hasDecimals ? 2 : 0,
    }).format(absAmount);
  } catch {
    // Fallback if Intl doesn't know the currency code
    const numStr = absAmount.toLocaleString(locale, {
      minimumFractionDigits: hasDecimals ? 2 : 0,
      maximumFractionDigits: hasDecimals ? 2 : 0,
    });
    formatted = `${currency.symbol}${numStr}`;
  }

  if (!showSign) return formatted;
  return amount < 0 ? `-${formatted}` : formatted;
}

export function parseCurrencyAmount(value: string): number {
  // Remove currency symbols and commas
  const cleaned = value.replace(/[^0-9.\-]/g, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Format an amount with explicit sign direction.
 * Debit (money out) = negative sign, Credit (money in) = no sign.
 */
export function formatSignedAmount(
  amount: number,
  isDebit: boolean,
  currency: Currency,
): string {
  const signedAmount = isDebit ? -Math.abs(amount) : Math.abs(amount);
  return formatCurrency(signedAmount, currency, true);
}

/**
 * Format a transaction's amount with sign derived from transaction type.
 * Debit (money out) = negative sign, Credit (money in) = no sign.
 */
export function formatTransactionAmount(transaction: {
  amount: number;
  type: { isDebit: boolean };
  localCurrency: Currency;
}): string {
  return formatSignedAmount(
    transaction.amount,
    transaction.type.isDebit,
    transaction.localCurrency,
  );
}
