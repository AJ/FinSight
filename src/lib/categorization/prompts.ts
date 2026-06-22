import { DEFAULT_CATEGORIES } from "./categories";
import { debugLog } from '@/lib/utils/debug';
import { normalizeMerchantName } from "@/lib/categorizer";
import { normalizeTransactionType } from '@/models/TransactionType';
import type { SourceType } from "@/types";
import type { TransactionSubType } from "@/models/Transaction";
import type { StatementType } from "@/types/creditCard";
import type { CategorizationSource } from "./types";
import type { JSONSchema } from "@/lib/llm/types";

/**
 * System prompt for transaction categorization.
 * Instructs the LLM on available categories and output format.
 */
// Generated from Category registry — single source of truth in categories.ts
const CATEGORY_GUIDANCE: Record<string, string> = Object.fromEntries(
  DEFAULT_CATEGORIES
    .filter(c => c.guidance)
    .map(c => [c.id, c.guidance!])
);

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
11. SUSPENSE RULE (CRITICAL): Any bank debit with transactionSubType "transfer" MUST be evaluated for suspense.
    - Flag as suspense (isSuspense: true) UNLESS the narration explicitly states the PURPOSE beyond just a recipient name or reference number.
    - Having a recipient name does NOT disqualify from suspense. ALL transfers have recipient names — that does not tell you the purpose.
    - Only mark isSuspense=false if the narration contains explicit purpose keywords like: "rent", "salary", "SIP", "mutual fund", "EMI", "loan", "insurance premium", "credit card payment", "investment", or similar.
    - Examples that SHOULD be flagged as suspense: "IMPS-533621763371RANJANA", "NEFT-Transfer to ABC Corp", "UPI-payment@paytm" — you cannot determine if this is rent, a purchase, a loan repayment, or a personal transfer.
    - When flagging as suspense, still provide your best-guess category (NOT "transfer") and confidence below 0.6.
    - The "transfer" category is ONLY for confirmed self-transfers (same person's own accounts). Never use it for external payments.

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

  // The persona + category taxonomy + rules live in CATEGORIZATION_SYSTEM_PROMPT, delivered
  // as the system message by aiCategorizer (spec §10). This user prompt carries only the
  // per-call data (statement context + the transaction batch) and the output-format note.
  return `${statementContext}Categorize these transactions:

[
  ${txnList}
]

Return a JSON array with this exact format:
[{"id": "original-id", "category": "category-id", "confidence": 0.95, "isSuspense": false}]

Set "isSuspense" to true for bank debit transfers where the narration does not explicitly state the purpose. Having a recipient name alone is NOT sufficient — flag as suspense unless you see purpose keywords like "rent", "salary", "SIP", "EMI", "investment", etc.

Important: Return ONLY the JSON array, nothing else.`;
}

/**
 * Parse the LLM response into structured categorization results.
 */
export function parseCategorizationResponse(
  response: string
): { id: string; category: string; confidence: number; source: CategorizationSource; isSuspense?: boolean }[] {
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
): { id: string; category: string; confidence: number; source: CategorizationSource; isSuspense?: boolean } {
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
    isSuspense: obj.isSuspense === true ? true : undefined,
  };
}

/**
 * Validate a categorization result.
 */
function isValidResult(
  result: { id: string; category: string; confidence: number; source: CategorizationSource; isSuspense?: boolean }
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

  // CC bill payment variations
  "credit_card_payment": "cc_bill_payment",
  "cc_payment": "cc_bill_payment",
  "card_payment": "cc_bill_payment",
  "credit_card_bill": "cc_bill_payment",
  "card_bill_payment": "cc_bill_payment",

  // Loan variations
  "loan_payment": "loans",
  "loan-payment": "loans",
  "emi": "loans",
  "loan_emi": "loans",
  "emi_payment": "loans",
  "loan_repayment": "loans",
  "home_loan_emi": "loans",
  "personal_loan_emi": "loans",
  "car_loan_emi": "loans",

  // Transfer variations — map to 'other' so they don't auto-assign to Excluded
  // User must explicitly classify; suspense system handles the review gate
  "imps_transfer": "other",
  "neft_transfer": "other",
  "rtgs_transfer": "other",
  "bank_transfer": "other",
  "money_transfer": "other",
  "fund_transfer": "other",
  "p2p_transfer": "other",
  "wire_transfer": "other",

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

/**
 * Permissive JSON Schema for the categorization response (spec §6). Co-located with the
 * prompt. Root is an array; each item constrains `category` to the registry's exact IDs so
 * the decoder cannot emit an invented category. `isSuspense` is optional (omitted when
 * false by the model is fine — parseCategorizationResponse tolerates absence).
 */
export const CATEGORIZATION_SCHEMA: JSONSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      category: { type: 'string', enum: DEFAULT_CATEGORIES.map((c) => c.id) },
      confidence: { type: 'number' },
      isSuspense: { type: 'boolean' },
    },
    required: ['id', 'category', 'confidence'],
    additionalProperties: true,
  },
};
