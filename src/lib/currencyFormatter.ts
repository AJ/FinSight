import { Currency } from "@/types";
import { getLocaleForCurrency } from "@/lib/parsers/currencyDetector";

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
  return amount < 0 ? `-${formatted}` : `+${formatted}`;
}

export function parseCurrencyAmount(value: string): number {
  // Remove currency symbols and commas
  const cleaned = value.replace(/[^0-9.\-]/g, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}
