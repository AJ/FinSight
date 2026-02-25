import { Currency } from "@/types";

/**
 * Comprehensive currency database — covers 50+ global currencies.
 * Each entry has: code, symbol, display name, locale for number formatting,
 * and optional regex fragments for detecting the currency in raw text.
 */
export const CURRENCY_DB: (Currency & {
  locale: string;
  patterns: RegExp[];
})[] = [
  {
    code: "INR",
    symbol: "₹",
    name: "Indian Rupee",
    locale: "en-IN",
    patterns: [/₹/, /\bINR\b/, /\bRs\.?\s/i, /\bRupees?\b/i],
  },
  {
    code: "USD",
    symbol: "$",
    name: "US Dollar",
    locale: "en-US",
    patterns: [/\$/, /\bUSD\b/, /\bUS\s?Dollar/i],
  },
  {
    code: "EUR",
    symbol: "€",
    name: "Euro",
    locale: "de-DE",
    patterns: [/€/, /\bEUR\b/, /\bEuro\b/i],
  },
  {
    code: "GBP",
    symbol: "£",
    name: "British Pound",
    locale: "en-GB",
    patterns: [/£/, /\bGBP\b/, /\bPound\s?Sterling\b/i],
  },
  {
    code: "JPY",
    symbol: "¥",
    name: "Japanese Yen",
    locale: "ja-JP",
    patterns: [/¥/, /\bJPY\b/, /\bYen\b/i],
  },
  {
    code: "CNY",
    symbol: "¥",
    name: "Chinese Yuan",
    locale: "zh-CN",
    patterns: [/\bCNY\b/, /\bRMB\b/, /\bYuan\b/i, /\b人民币\b/],
  },
  {
    code: "AUD",
    symbol: "A$",
    name: "Australian Dollar",
    locale: "en-AU",
    patterns: [/A\$/, /\bAUD\b/],
  },
  {
    code: "CAD",
    symbol: "C$",
    name: "Canadian Dollar",
    locale: "en-CA",
    patterns: [/C\$/, /\bCAD\b/],
  },
  {
    code: "CHF",
    symbol: "Fr",
    name: "Swiss Franc",
    locale: "de-CH",
    patterns: [/\bCHF\b/, /\bFr\.?\s/],
  },
  {
    code: "SEK",
    symbol: "kr",
    name: "Swedish Krona",
    locale: "sv-SE",
    patterns: [/\bSEK\b/, /\bkr\b/],
  },
  {
    code: "NOK",
    symbol: "kr",
    name: "Norwegian Krone",
    locale: "nb-NO",
    patterns: [/\bNOK\b/],
  },
  {
    code: "DKK",
    symbol: "kr",
    name: "Danish Krone",
    locale: "da-DK",
    patterns: [/\bDKK\b/],
  },
  {
    code: "SGD",
    symbol: "S$",
    name: "Singapore Dollar",
    locale: "en-SG",
    patterns: [/S\$/, /\bSGD\b/],
  },
  {
    code: "HKD",
    symbol: "HK$",
    name: "Hong Kong Dollar",
    locale: "en-HK",
    patterns: [/HK\$/, /\bHKD\b/],
  },
  {
    code: "NZD",
    symbol: "NZ$",
    name: "New Zealand Dollar",
    locale: "en-NZ",
    patterns: [/NZ\$/, /\bNZD\b/],
  },
  {
    code: "ZAR",
    symbol: "R",
    name: "South African Rand",
    locale: "en-ZA",
    patterns: [/\bZAR\b/, /\bRand\b/i],
  },
  {
    code: "BRL",
    symbol: "R$",
    name: "Brazilian Real",
    locale: "pt-BR",
    patterns: [/R\$/, /\bBRL\b/, /\bReal\b/i],
  },
  {
    code: "MXN",
    symbol: "MX$",
    name: "Mexican Peso",
    locale: "es-MX",
    patterns: [/MX\$/, /\bMXN\b/],
  },
  {
    code: "ARS",
    symbol: "AR$",
    name: "Argentine Peso",
    locale: "es-AR",
    patterns: [/AR\$/, /\bARS\b/],
  },
  {
    code: "CLP",
    symbol: "CL$",
    name: "Chilean Peso",
    locale: "es-CL",
    patterns: [/CL\$/, /\bCLP\b/],
  },
  {
    code: "COP",
    symbol: "COL$",
    name: "Colombian Peso",
    locale: "es-CO",
    patterns: [/COL\$/, /\bCOP\b/],
  },
  {
    code: "MYR",
    symbol: "RM",
    name: "Malaysian Ringgit",
    locale: "ms-MY",
    patterns: [/\bRM\b/, /\bMYR\b/, /\bRinggit\b/i],
  },
  {
    code: "THB",
    symbol: "฿",
    name: "Thai Baht",
    locale: "th-TH",
    patterns: [/฿/, /\bTHB\b/, /\bBaht\b/i],
  },
  {
    code: "IDR",
    symbol: "Rp",
    name: "Indonesian Rupiah",
    locale: "id-ID",
    patterns: [/\bRp\.?\s/, /\bIDR\b/, /\bRupiah\b/i],
  },
  {
    code: "PHP",
    symbol: "₱",
    name: "Philippine Peso",
    locale: "en-PH",
    patterns: [/₱/, /\bPHP\b/],
  },
  {
    code: "VND",
    symbol: "₫",
    name: "Vietnamese Dong",
    locale: "vi-VN",
    patterns: [/₫/, /\bVND\b/],
  },
  {
    code: "KRW",
    symbol: "₩",
    name: "South Korean Won",
    locale: "ko-KR",
    patterns: [/₩/, /\bKRW\b/],
  },
  {
    code: "TWD",
    symbol: "NT$",
    name: "Taiwan Dollar",
    locale: "zh-TW",
    patterns: [/NT\$/, /\bTWD\b/],
  },
  {
    code: "TRY",
    symbol: "₺",
    name: "Turkish Lira",
    locale: "tr-TR",
    patterns: [/₺/, /\bTRY\b/, /\bTL\b/],
  },
  {
    code: "RUB",
    symbol: "₽",
    name: "Russian Ruble",
    locale: "ru-RU",
    patterns: [/₽/, /\bRUB\b/, /\bруб/],
  },
  {
    code: "PLN",
    symbol: "zł",
    name: "Polish Zloty",
    locale: "pl-PL",
    patterns: [/zł/, /\bPLN\b/],
  },
  {
    code: "CZK",
    symbol: "Kč",
    name: "Czech Koruna",
    locale: "cs-CZ",
    patterns: [/Kč/, /\bCZK\b/],
  },
  {
    code: "HUF",
    symbol: "Ft",
    name: "Hungarian Forint",
    locale: "hu-HU",
    patterns: [/\bFt\b/, /\bHUF\b/],
  },
  {
    code: "RON",
    symbol: "lei",
    name: "Romanian Leu",
    locale: "ro-RO",
    patterns: [/\blei\b/, /\bRON\b/],
  },
  {
    code: "ILS",
    symbol: "₪",
    name: "Israeli Shekel",
    locale: "he-IL",
    patterns: [/₪/, /\bILS\b/, /\bShekel\b/i],
  },
  {
    code: "AED",
    symbol: "د.إ",
    name: "UAE Dirham",
    locale: "ar-AE",
    patterns: [/\bAED\b/, /\bDirham\b/i, /د\.إ/],
  },
  {
    code: "SAR",
    symbol: "﷼",
    name: "Saudi Riyal",
    locale: "ar-SA",
    patterns: [/\bSAR\b/, /\bRiyal\b/i, /﷼/],
  },
  {
    code: "QAR",
    symbol: "QR",
    name: "Qatari Riyal",
    locale: "ar-QA",
    patterns: [/\bQAR\b/],
  },
  {
    code: "KWD",
    symbol: "KD",
    name: "Kuwaiti Dinar",
    locale: "ar-KW",
    patterns: [/\bKWD\b/, /\bKD\b/],
  },
  {
    code: "BHD",
    symbol: "BD",
    name: "Bahraini Dinar",
    locale: "ar-BH",
    patterns: [/\bBHD\b/],
  },
  {
    code: "OMR",
    symbol: "OMR",
    name: "Omani Rial",
    locale: "ar-OM",
    patterns: [/\bOMR\b/],
  },
  {
    code: "EGP",
    symbol: "E£",
    name: "Egyptian Pound",
    locale: "ar-EG",
    patterns: [/E£/, /\bEGP\b/],
  },
  {
    code: "NGN",
    symbol: "₦",
    name: "Nigerian Naira",
    locale: "en-NG",
    patterns: [/₦/, /\bNGN\b/, /\bNaira\b/i],
  },
  {
    code: "KES",
    symbol: "KSh",
    name: "Kenyan Shilling",
    locale: "en-KE",
    patterns: [/\bKSh\b/, /\bKES\b/],
  },
  {
    code: "GHS",
    symbol: "GH₵",
    name: "Ghanaian Cedi",
    locale: "en-GH",
    patterns: [/GH₵/, /\bGHS\b/],
  },
  {
    code: "PKR",
    symbol: "₨",
    name: "Pakistani Rupee",
    locale: "en-PK",
    patterns: [/\bPKR\b/, /₨/],
  },
  {
    code: "BDT",
    symbol: "৳",
    name: "Bangladeshi Taka",
    locale: "bn-BD",
    patterns: [/৳/, /\bBDT\b/, /\bTaka\b/i],
  },
  {
    code: "LKR",
    symbol: "Rs",
    name: "Sri Lankan Rupee",
    locale: "si-LK",
    patterns: [/\bLKR\b/],
  },
  {
    code: "NPR",
    symbol: "Rs",
    name: "Nepalese Rupee",
    locale: "ne-NP",
    patterns: [/\bNPR\b/],
  },
];

/**
 * Detect currency from raw text (PDF text, CSV headers, or any string).
 * Returns the best match or null if nothing obvious is found.
 *
 * Priority: unique symbols (₹, €, £, ₺) > ISO codes (INR, USD) > words (Rupee, Dollar).
 * We score each currency by the number of pattern matches and pick the highest.
 */
export function detectCurrencyFromText(text: string): Currency | null {
  if (!text || text.length === 0) return null;

  // Take a reasonable sample (first 5000 chars + last 2000 chars)
  const sample =
    text.length > 7000
      ? text.substring(0, 5000) + "\n" + text.substring(text.length - 2000)
      : text;

  let bestMatch: (typeof CURRENCY_DB)[number] | null = null;
  let bestScore = 0;

  for (const curr of CURRENCY_DB) {
    let score = 0;
    for (const pattern of curr.patterns) {
      const matches = sample.match(new RegExp(pattern.source, "gi"));
      if (matches) {
        // Weight: unique symbols score higher than words
        const isSymbol = /[₹€£¥₺₽₩₪₦₱₫৳฿]/.test(pattern.source);
        const isCode = /\\b[A-Z]{3}\\b/.test(pattern.source);
        const weight = isSymbol ? 3 : isCode ? 2 : 1;
        score += matches.length * weight;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = curr;
    }
  }

  if (bestMatch && bestScore >= 1) {
    return {
      code: bestMatch.code,
      symbol: bestMatch.symbol,
      name: bestMatch.name,
    };
  }
  return null;
}

/**
 * Get the locale string for a currency code.
 */
export function getLocaleForCurrency(code: string): string {
  const entry = CURRENCY_DB.find((c) => c.code === code);
  return entry?.locale || "en-US";
}

/**
 * Try to detect currency from CSV/XLS column headers.
 * E.g. "Amount (INR)", "Debit (₹)", "Credit(Rs.)"
 */
export function detectCurrencyFromHeaders(headers: string[]): Currency | null {
  const joined = headers.join(" ");
  return detectCurrencyFromText(joined);
}
