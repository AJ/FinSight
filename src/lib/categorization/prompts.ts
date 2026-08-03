import { DEFAULT_CATEGORIES } from "./categories";
import { debugLog } from '@/lib/utils/debug';
import { normalizeMerchantName } from "@/lib/categorizer";
import { normalizeTransactionType } from '@/models/TransactionType';
import type { SourceType } from "@/types";
import { TRANSACTION_SUB_TYPES, type TransactionSubType } from "@/models/Transaction";
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
6. The "merchant" field is a cleaned hint, not authoritative. It is useful when it surfaces a real retailer hidden in a noisy description, but it can also be wrong — for transfers it may carry a bank name or payment app rather than a payee. When "merchant" and "description" disagree, trust the description.
7. You are the SOLE authority for transactionSubType. Decide the subType FIRST from the narration and direction, THEN pick a category valid for that subType. Allowed subTypes: ${TRANSACTION_SUB_TYPES.join(", ")}. You MUST include transactionSubType in EVERY result object — never omit it. Decide the subType from the narration per rule 11.
8. If the merchant is low-signal and the transaction is ambiguous, prefer "other" with low confidence instead of overconfident guessing
9. Do NOT infer category from amount alone or from unrelated numeric tokens
10. If a learned merchant mapping is provided in future prompts, treat it as a strong hint, but still return one of the allowed category IDs
11. FUND MOVEMENTS vs PURCHASES (self_transfer): self_transfer means a FUND MOVEMENT — money sent to another account or person. It does NOT mean "a debit you can't otherwise categorize." Decide from what the money did, not from whether you recognize a keyword.
    - A purchase of goods or services from a merchant/retailer is NEVER self_transfer — use purchase (or bank_charge for issuer fees, charge for taxes/forex). A named merchant (Amazon, a restaurant, a store, a utility provider) or any description of goods/services means purchase, whether or not a "purpose keyword" appears. This is the most common debit type — default to purchase for ordinary spending, not self_transfer.
    - self_transfer is for movements to an account, a person, a payment handle, or a generic payee — e.g. "Transfer to RANJANA", "NEFT-…", "UPI-payment@…", "Moved to savings", "Sent to John", "To A/c 12345". The destination is not a merchant, so ownership is unresolved: assign self_transfer and category "transfer"; the reviewer confirms whether it is the user's own account.
    - Payment rails (IMPS/NEFT/UPI/RTGS/ACH/SEPA/Wire/Zelle/Pix) are EXAMPLES of fund movements, not the trigger. A movement phrased with no rail word is still self_transfer; a purchase that happens to mention a rail is still a purchase.
    - The "transfer" category is for fund movements only (self_transfer subtype).

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
    ? statementType === "credit_card"
      ? `Statement context: These transactions are from a Credit Card statement. Direction is inverted vs a bank account — a DEBIT is a purchase or charge (money spent on the card); a CREDIT is money ONTO the card, NEVER income. On a credit card statement:\n  - A credit with payment keywords ("PAYMENT RECEIVED", "BBPS", "BILL PAYMENT", "AUTO-PAY"/"AUTOPAY", "PAID", or NEFT/UPI/IMPS/RTGS/ACH/SEPA/WIRE routed to the card) is a bill payment → transactionSubType "debt_payment", category "cc_bill_payment".\n  - "cashback"/"valueback"/"reward cash" credit → transactionSubType "rewards".\n  - A merchant credit for a returned/cancelled/reversed purchase → transactionSubType "refund".\n\n`
      : `Statement context: These transactions are from a Bank statement. A credit is money into the account (salary/deposit/refund/interest); a debit is money out.\n\n`
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
[{"id": "original-id", "transactionSubType": "<subType>", "category": "category-id", "confidence": <0.0-1.0>}]

The confidence above is a placeholder — fill in your own score per rule 3. Do NOT copy a fixed value across transactions; it must reflect each transaction's actual evidence.

Choose the subType before the category. Include transactionSubType on EVERY object — it is required, not optional. self_transfer is for FUND MOVEMENTS (money sent to an account/person) only — a merchant purchase is purchase/charge, never self_transfer, even when no keyword is present.

Important: Return ONLY the JSON array, nothing else.`;
}

/**
 * Parse the LLM response into structured categorization results.
 */
export function parseCategorizationResponse(
  response: string
): { id: string; category: string; confidence: number; source: CategorizationSource; transactionSubType?: TransactionSubType }[] {
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
): { id: string; category: string; confidence: number; source: CategorizationSource; transactionSubType?: TransactionSubType } {
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

  // Classification is the subtype authority. Accept only canonical subtypes; anything else
  // (a hallucinated string) is dropped so the caller falls back to the transaction's existing
  // subtype or the failure-path default.
  const rawSubType = typeof obj.transactionSubType === 'string' ? obj.transactionSubType.toLowerCase() : undefined;
  const transactionSubType =
    rawSubType && (TRANSACTION_SUB_TYPES as readonly string[]).includes(rawSubType)
      ? (rawSubType as TransactionSubType)
      : undefined;

  return {
    id: String(obj.id || ""),
    category: normalizeCategoryId(rawCategory),
    confidence,
    source: hasValidAiConfidence ? "ai" : "keyword",
    transactionSubType,
  };
}

/**
 * Validate a categorization result.
 */
function isValidResult(
  result: { id: string; category: string; confidence: number; source: CategorizationSource; transactionSubType?: TransactionSubType }
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

  // Unknown category. Deliberately no fuzzy/substring fallback: bidirectional
  // substring matching misrouted free-form strings because short aliases
  // ("emi", "stocks", "premium") appear inside unrelated words (e.g. "seminar"
  // → loans, "livestocks" → investment). Known spellings belong in the alias
  // table above; anything else is honestly reported as "other".
  debugLog('categorize', `Unknown category "${categoryId}", using "other"`);
  return "other";
}

/**
 * Permissive JSON Schema for the categorization response (spec §6). Co-located with the
 * prompt. Root is an array; each item constrains `category` to the registry's exact IDs and
 * `transactionSubType` to the canonical enum, so the decoder cannot emit an invented value.
 */
export const CATEGORIZATION_SCHEMA: JSONSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      category: { type: 'string', enum: DEFAULT_CATEGORIES.map((c) => c.id) },
      transactionSubType: { type: 'string', enum: [...TRANSACTION_SUB_TYPES] },
      confidence: { type: 'number' },
    },
    required: ['id', 'category', 'confidence', 'transactionSubType'],
    additionalProperties: true,
  },
};
