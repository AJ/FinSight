import { DEFAULT_CATEGORIES } from "./categories";
import { debugLog } from '@/lib/utils/debug';
import { normalizeMerchantName } from "@/lib/categorizer";
import { normalizeTransactionType } from '@/models/TransactionType';
import type { SourceType } from "@/types";
import type { TransactionSubType } from "@/models/Transaction";
import type { StatementType } from "@/types/creditCard";
import type { CategorizationSource } from "./types";

/**
 * System prompt for transaction categorization.
 * Instructs the LLM on available categories and output format.
 */
const CATEGORY_GUIDANCE: Record<string, string> = {
  groceries: "Supermarkets, grocery stores, fresh produce, food staples, and routine household essentials.",
  dining: "Restaurants, cafes, coffee shops, bars, takeout, and food delivery.",
  transportation: "Fuel, public transit, ride-hailing, taxi, parking, tolls, and vehicle upkeep.",
  utilities: "Electricity, water, gas, internet, mobile, phone, and other utility bills.",
  housing: "Rent, mortgage, housing maintenance, HOA, and property-related costs.",
  healthcare: "Pharmacy, doctor, clinic, hospital, medical treatment, and health-related spending.",
  entertainment: "Streaming, movies, games, concerts, subscriptions, and leisure spending.",
  shopping: "Retail, e-commerce, electronics, apparel, home goods, and general shopping.",
  income: "Salary, payroll, freelance income, reimbursements treated as income, and money earned from work.",
  interest: "Interest credited by a bank or financial institution.",
  cashback: "Cashback, reward credits, rebates, gift voucher credits, and similar incentive credits.",
  transfer: "Money moved between accounts or people, including bank transfers and peer-to-peer transfers.",
  bills: "Credit-card bill payments, loan repayments, EMI, and other bill-payment transactions.",
  investment: "Brokerage, securities, mutual funds, crypto, dividends, or investment-related flows.",
  insurance: "Insurance premiums and policy-related payments.",
  education: "Tuition, courses, books, training, tutoring, and education-related payments.",
  travel: "Flights, hotels, lodging, rental cars, and trip-related spending.",
  fees: "Bank fees, service fees, annual fees, processing fees, and similar charges.",
  taxes: "Tax, GST, VAT, IGST, SGST, duty, cess, and similar tax-related debits.",
  "interest-expense": "Interest charged as an expense, finance charges, overdue interest, and penal interest.",
  other: "Use this only when the merchant or purpose is genuinely unclear. Prefer other over guessing.",
};

export const CATEGORIZATION_SYSTEM_PROMPT = `You are a financial transaction categorization assistant. Your task is to categorize transactions into the most appropriate category based on the description, merchant context, amount, direction, source type, and transaction subtype.

STRICT CATEGORY LIST - You MUST use ONLY these exact category IDs (do not invent new ones):
${DEFAULT_CATEGORIES.map((c) => `"${c.id}"`).join(", ")}

Rules:
1. Return ONLY valid JSON, no markdown code blocks, no explanation
2. The "category" field MUST be one of the exact IDs listed above - no variations, no synonyms
3. Provide a confidence score (0.0-1.0) for each categorization:
   - 0.9-1.0: Very certain (description clearly matches category)
   - 0.7-0.89: Fairly certain (description strongly suggests category)
   - 0.5-0.69: Somewhat certain (reasonable guess based on patterns)
   - Below 0.5: Uncertain (use "other" category)
4. If truly uncertain, use "other" with confidence around 0.4
5. The "direction" field indicates credit (money in) or debit (money out)
6. Use "merchant" as the normalized merchant clue when provided; it may be more informative than the raw description
7. Use "sourceType" and "transactionSubType" as strong hints when present
8. If the merchant is low-signal and the transaction is ambiguous, prefer "other" with low confidence instead of overconfident guessing
9. Do NOT infer category from amount alone or from unrelated numeric tokens
10. If a learned merchant mapping is provided in future prompts, treat it as a strong hint, but still return one of the allowed category IDs

Category guidance:
${Object.entries(CATEGORY_GUIDANCE)
  .map(([categoryId, guidance]) => `- "${categoryId}": ${guidance}`)
  .join("\n")}`;

/**
 * Build the user prompt with transaction data.
 */
export type CategorizationTxnType = "credit" | "debit" | "income" | "expense";

export function buildCategorizationPrompt(
  transactions: {
    id: string;
    description: string;
    amount: number;
    type: CategorizationTxnType;
    merchant?: string;
    sourceType?: SourceType;
    transactionSubType?: TransactionSubType;
  }[],
  statementType?: StatementType
): string {
  const statementContext = statementType
    ? `Statement context: These transactions are from a ${statementType === "bank" ? "Bank" : "Credit Card"} statement. Use this to interpret keywords appropriately (e.g., "Credit" means a refund/deposit in bank statements, but a purchase in credit card statements).\n\n`
    : "";

  const txnList = transactions
    .map((t) => {
      const payload: Record<string, string | number> = {
        id: t.id,
        description: t.description,
        merchant: (t.merchant && t.merchant.trim()) || normalizeMerchantName(t.description),
        amount: t.amount,
        direction: normalizeTransactionType(t.type) ?? "debit",
      };

      if (t.sourceType) {
        payload.sourceType = t.sourceType;
      }

      if (t.transactionSubType) {
        payload.transactionSubType = t.transactionSubType;
      }

      return JSON.stringify(payload);
    })
    .join(",\n  ");

  return `${CATEGORIZATION_SYSTEM_PROMPT}

${statementContext}Categorize these transactions:

[
  ${txnList}
]

Return a JSON array with this exact format:
[{"id": "original-id", "category": "category-id", "confidence": 0.95}]

Important: Return ONLY the JSON array, nothing else.`;
}

/**
 * Parse the LLM response into structured categorization results.
 */
export function parseCategorizationResponse(
  response: string
): { id: string; category: string; confidence: number; source: CategorizationSource }[] {
  // Try direct parse
  try {
    const parsed = JSON.parse(response);
    if (Array.isArray(parsed)) {
      return parsed.map(normalizeResult).filter(isValidResult);
    }
  } catch {
    // Continue to try extraction
  }

  // Try extracting JSON from markdown code blocks
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeResult).filter(isValidResult);
      }
    } catch {
      // Continue to try extraction
    }
  }

  // Try extracting the largest JSON array
  const arrayMatch = response.match(/\[[\s\S]*?\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeResult).filter(isValidResult);
      }
    } catch {
      // Continue
    }
  }

  // Try fixing common issues
  if (arrayMatch) {
    let fixed = arrayMatch[0];
    // Remove trailing commas
    fixed = fixed.replace(/,\s*([}\]])/g, "$1");
    try {
      const parsed = JSON.parse(fixed);
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeResult).filter(isValidResult);
      }
    } catch {
      // Give up
    }
  }

  return [];
}

/**
 * Normalize a single result object.
 */
function normalizeResult(
  result: unknown
): { id: string; category: string; confidence: number; source: CategorizationSource } {
  const obj = result as Record<string, unknown>;
  const rawCategory = String(obj.category || "other");
  const rawConfidence = obj.confidence;

  // Parse confidence: must be valid number between 0-1, otherwise low confidence fallback
  let confidence = 0.2; // Default to low confidence
  let hasValidAiConfidence = false;

  if (typeof rawConfidence === "number" && rawConfidence >= 0 && rawConfidence <= 1) {
    confidence = rawConfidence;
    hasValidAiConfidence = true;
  } else if (typeof rawConfidence === "string") {
    const parsedConfidence = Number(rawConfidence.trim());
    if (!Number.isNaN(parsedConfidence) && parsedConfidence >= 0 && parsedConfidence <= 1) {
      confidence = parsedConfidence;
      hasValidAiConfidence = true;
    }
  }

  return {
    id: String(obj.id || ""),
    category: normalizeCategoryId(rawCategory),
    confidence,
    source: hasValidAiConfidence ? "ai" : "keyword",
  };
}

/**
 * Validate a categorization result.
 */
function isValidResult(
  result: { id: string; category: string; confidence: number; source: CategorizationSource }
): boolean {
  const validCategories = DEFAULT_CATEGORIES.map((c) => c.id);
  return (
    result.id.length > 0 &&
    validCategories.includes(result.category) &&
    result.confidence >= 0 &&
    result.confidence <= 1
  );
}

/**
 * Common category aliases that LLMs might use.
 * Maps LLM-invented category names to the correct IDs.
 */
const CATEGORY_ALIASES: Record<string, string> = {
  // Bills variations
  "bill_payment": "bills",
  "bill-pay": "bills",
  "billpay": "bills",
  "bill payments": "bills",
  "loan_payment": "bills",
  "loan-payment": "bills",
  "emi": "bills",
  "credit_card_payment": "bills",
  "cc_payment": "bills",

  // Transfer variations
  "imps_transfer": "transfer",
  "neft_transfer": "transfer",
  "rtgs_transfer": "transfer",
  "bank_transfer": "transfer",
  "money_transfer": "transfer",
  "fund_transfer": "transfer",
  "p2p_transfer": "transfer",
  "wire_transfer": "transfer",

  // Insurance variations
  "insurance_payment": "insurance",
  "insurance_premium": "insurance",
  "premium": "insurance",

  // Income variations
  "salary": "income",
  "wages": "income",
  "payroll": "income",
  "earnings": "income",

  // Interest variations
  "interest_credit": "interest",
  "interest_income": "interest",
  "bank_interest": "interest",

  // Investment variations
  "dividend": "investment",
  "stocks": "investment",
  "crypto": "investment",
  "trading": "investment",
};

/**
 * Normalize a category ID, mapping aliases to canonical IDs.
 */
export function normalizeCategoryId(categoryId: string): string {
  const normalized = categoryId.toLowerCase().trim().replace(/\s+/g, "_");

  // Check if it's a valid category
  const validCategories = DEFAULT_CATEGORIES.map((c) => c.id);
  if (validCategories.includes(normalized)) {
    return normalized;
  }

  // Check aliases
  if (CATEGORY_ALIASES[normalized]) {
    debugLog('categorize', `Mapped alias "${categoryId}" → "${CATEGORY_ALIASES[normalized]}"`);
    return CATEGORY_ALIASES[normalized];
  }

  // Check for partial matches in aliases
  for (const [alias, canonical] of Object.entries(CATEGORY_ALIASES)) {
    if (normalized.includes(alias) || alias.includes(normalized)) {
      debugLog('categorize', `Mapped partial alias "${categoryId}" → "${canonical}"`);
      return canonical;
    }
  }

  // Unknown category
  debugLog('categorize', `Unknown category "${categoryId}", using "other"`);
  return "other";
}
