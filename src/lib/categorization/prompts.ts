import { DEFAULT_CATEGORIES } from "./categories";

/**
 * System prompt for transaction categorization.
 * Instructs the LLM on available categories and output format.
 */
export const CATEGORIZATION_SYSTEM_PROMPT = `You are a financial transaction categorization assistant. Your task is to categorize transactions into the most appropriate category based on the description, amount, and transaction type.

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

Category guidance:
- "income": Salary, wages, freelance payments (money earned from work)
- "transfer": NEFT, IMPS, RTGS, bank transfers, Zelle, Venmo (money moved between accounts/people)
- "interest": Bank interest credits
- "bills": Credit card payments, loan payments, EMI, bill payments
- "insurance": Insurance premium payments`;


/**
 * Build the user prompt with transaction data.
 */
export function buildCategorizationPrompt(
  transactions: { id: string; description: string; amount: number; type: "income" | "expense" }[]
): string {
  const txnList = transactions
    .map(
      (t) =>
        `{"id": "${t.id}", "description": "${escapeJson(t.description)}", "amount": ${t.amount}, "direction": "${t.type === "income" ? "credit" : "debit"}"}`
    )
    .join(",\n  ");

  return `${CATEGORIZATION_SYSTEM_PROMPT}

Categorize these transactions:

[
  ${txnList}
]

Return a JSON array with this exact format:
[{"id": "original-id", "category": "category-id", "confidence": 0.95}]

Important: Return ONLY the JSON array, nothing else.`;
}

/**
 * Escape special characters for JSON strings.
 */
function escapeJson(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Parse the LLM response into structured categorization results.
 */
export function parseCategorizationResponse(
  response: string
): { id: string; category: string; confidence: number }[] {
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
): { id: string; category: string; confidence: number } {
  const obj = result as Record<string, unknown>;
  const rawCategory = String(obj.category || "other");
  return {
    id: String(obj.id || ""),
    category: normalizeCategoryId(rawCategory),
    confidence: typeof obj.confidence === "number" ? obj.confidence : 0.5,
  };
}

/**
 * Validate a categorization result.
 */
function isValidResult(
  result: { id: string; category: string; confidence: number }
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
    console.log(`[Categorize] Mapped alias "${categoryId}" → "${CATEGORY_ALIASES[normalized]}"`);
    return CATEGORY_ALIASES[normalized];
  }

  // Check for partial matches in aliases
  for (const [alias, canonical] of Object.entries(CATEGORY_ALIASES)) {
    if (normalized.includes(alias) || alias.includes(normalized)) {
      console.log(`[Categorize] Mapped partial alias "${categoryId}" → "${canonical}"`);
      return canonical;
    }
  }

  // Unknown category
  console.log(`[Categorize] Unknown category "${categoryId}", using "other"`);
  return "other";
}
