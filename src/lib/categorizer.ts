import { Category } from "@/models";
import type { TransactionSubType } from "@/models/Transaction";
import { categoriesFor } from "@/lib/classification/subtypeCategories";

export function categorizeTransaction(
  description: string,
  transactionSubType?: TransactionSubType,
): string {
  // A subtype is required. Keyword matching is constrained to the categories valid
  // for the subtype, and every Transaction carries one (defaultSubtype fills it at
  // construction for every extraction/import path). Reaching here without a subtype
  // is a bug — fail loudly instead of guessing against the full category list, which
  // only ever produced arbitrary, often-wrong categories on impossible input.
  if (!transactionSubType) {
    throw new Error(
      "categorizeTransaction requires a transactionSubType but received none. " +
        "Every Transaction must carry a subtype (see defaultSubtype).",
    );
  }

  const lowerDesc = description.toLowerCase();

  // First-match-wins on keyword inclusion, scanning the categories valid for this
  // subtype in their defined order. The first category whose keyword appears in the
  // description wins. Known limitation of the keyword fallback (0.3 confidence).
  const candidates = categoriesFor(transactionSubType);

  for (const category of candidates) {
    for (const keyword of category.keywords) {
      if (lowerDesc.includes(keyword.toLowerCase())) return category.id;
    }
  }

  // No keyword match: return a category valid for the subtype — prefer 'other'
  // (the misc bucket) when it is valid for this subtype, else the first valid
  // category. This keeps every fallback output a valid (subtype, category) combo.
  if (candidates.length === 0) return Category.DEFAULT_ID;
  return candidates.some((c) => c.id === Category.DEFAULT_ID)
    ? Category.DEFAULT_ID
    : candidates[0].id;
}

/**
 * Normalize merchant/payee name from raw description text.
 * Works with any bank — focuses on cleaning common patterns.
 */
export function normalizeMerchantName(description: string): string {
  let normalized = description;

  // Remove trailing reference numbers / transaction IDs
  normalized = normalized.replace(/\s*#?\d{6,}$/g, "");
  normalized = normalized.replace(/\s+\d{2}\/\d{2}$/g, "");
  normalized = normalized.replace(/\*+/g, "");
  // Remove UPI/NEFT/IMPS prefixes (Indian banking)
  normalized = normalized.replace(
    /^(UPI[-/]|NEFT[-/]|IMPS[-/]|RTGS[-/]|NACH[-/])/i,
    "",
  );
  // Remove wire transfer prefixes
  normalized = normalized.replace(/^(WIRE|ACH|XFER|TFR|TRANSFER)[-/\s]+/i, "");
  // Remove card transaction prefixes
  normalized = normalized.replace(
    /^(POS|ATM|CARD|VISA|MC|MASTERCARD|DEBIT CARD)[-/\s]+/i,
    "",
  );
  // Remove common noise patterns
  normalized = normalized.replace(/\s*[-/]\s*\d{4,}$/g, "");
  normalized = normalized.replace(/\s*REF:?\s*\S+$/i, "");
  normalized = normalized.replace(/\s*TXN:?\s*\S+$/i, "");

  // Known merchant pattern normalization (international)
  const merchantPatterns: Record<string, string> = {
    // Global
    AMZN: "Amazon",
    AMZ: "Amazon",
    AMAZON: "Amazon",
    NETFLIX: "Netflix",
    SPOTIFY: "Spotify",
    GOOGLE: "Google",
    APPLE: "Apple",
    MICROSOFT: "Microsoft",
    YOUTUBE: "YouTube",
    UBER: "Uber",
    LYFT: "Lyft",
    GRAB: "Grab",
    OLA: "Ola",
    // US
    SBUX: "Starbucks",
    STARBUCKS: "Starbucks",
    WALMART: "Walmart",
    TARGET: "Target",
    "WHOLE FOODS": "Whole Foods",
    "TRADER JOE": "Trader Joe's",
    // India
    SWIGGY: "Swiggy",
    ZOMATO: "Zomato",
    FLIPKART: "Flipkart",
    MYNTRA: "Myntra",
    PAYTM: "Paytm",
    PHONEPE: "PhonePe",
    GPAY: "Google Pay",
    BIGBASKET: "BigBasket",
    BLINKIT: "Blinkit",
    ZEPTO: "Zepto",
    DUNZO: "Dunzo",
    RAPIDO: "Rapido",
    JIO: "Jio",
    AIRTEL: "Airtel",
    VODAFONE: "Vodafone",
    // Banks deliberately omitted. A bank name in a narration is the routing
    // institution (e.g. "ICICI IB:Sent NEFT ..."), not the merchant. Substituting
    // "ICICI"/"HDFC" handed the categorizer a bank brand for a personal transfer,
    // steering it toward loans/finance. Payments to a bank (EMI, insurance premium)
    // are categorized by their purpose keywords in the description, not by a bank
    // "merchant", so omitting them loses nothing and fixes the transfer crush.
    // UK / Europe
    TESCO: "Tesco",
    SAINSBURY: "Sainsbury's",
    ASDA: "Asda",
    ALDI: "Aldi",
    LIDL: "Lidl",
    DELIVEROO: "Deliveroo",
    // Southeast Asia
    SHOPEE: "Shopee",
    LAZADA: "Lazada",
    GOJEK: "Gojek",
    GRABFOOD: "GrabFood",
    FOODPANDA: "Foodpanda",
  };

  const upperNormalized = normalized.toUpperCase();
  for (const [pattern, name] of Object.entries(merchantPatterns)) {
    if (upperNormalized.includes(pattern)) {
      return name;
    }
  }

  return normalized.trim();
}
