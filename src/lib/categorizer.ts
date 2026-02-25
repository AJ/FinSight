import { Category } from "@/types";

export function categorizeTransaction(
  description: string,
  amount: number,
  categories: Category[],
): string {
  const lowerDesc = description.toLowerCase();
  const type: "income" | "expense" = amount >= 0 ? "income" : "expense";

  // Try to match with category keywords
  for (const category of categories) {
    if (category.type !== type && category.type !== "both") continue;

    for (const keyword of category.keywords) {
      if (lowerDesc.includes(keyword.toLowerCase())) {
        return category.id;
      }
    }
  }

  // Default categorization based on type
  if (type === "income") {
    const incomeCategory = categories.find((c) => c.type === "income");
    return incomeCategory?.id || "other";
  }

  const otherCategory = categories.find((c) => c.id === "other");
  return otherCategory?.id || "other";
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
    HDFC: "HDFC",
    ICICI: "ICICI",
    SBI: "SBI",
    AXIS: "Axis Bank",
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
