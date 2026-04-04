import { normalizeMerchantName } from "@/lib/categorizer";
import type { SourceType, Transaction } from "@/types";

export type MerchantRuleDirection = "credit" | "debit" | "any";
export type MerchantRuleSourceType = SourceType | "any";

export interface MerchantRule {
  merchantKey: string;
  categoryId: string;
  direction: MerchantRuleDirection;
  sourceType: MerchantRuleSourceType;
  confirmations: number;
  lastConfirmedAt: string;
  sampleDescription: string;
  ambiguous?: boolean;
}

export interface MerchantRuleMatchInput {
  merchantKey: string;
  direction: MerchantRuleDirection;
  sourceType: MerchantRuleSourceType;
}

export interface MerchantRuleDecision {
  merchantKey: string;
  categoryId: string;
  direction: MerchantRuleDirection;
  sourceType: MerchantRuleSourceType;
  sampleDescription: string;
}

const PAYMENT_RAIL_NOISE =
  /\b(?:upi|neft|imps|rtgs|ach|autopay|payzapp|payment|bill payment|billpay|xfer|transfer|txn|utr|rrn)\b/gi;
const REF_NOISE =
  /\b(?:ref|ref#|reference|order|txn|txnid|auth|approval)\b[:#-]?\s*[a-z0-9-]+/gi;
const DATE_TIME_NOISE =
  /\b\d{1,2}[:/-]\d{1,2}(?:[:/-]\d{1,4})?(?:\s+\d{1,2}:\d{2})?\b/g;

export function buildMerchantKey(rawText?: string): string {
  if (!rawText || !rawText.trim()) {
    return "__unknown__";  // Empty descriptions get a consistent key
  }

  const normalized = normalizeMerchantName(rawText)
    .replace(/\([^)]*\)/g, " ")
    .replace(REF_NOISE, " ")
    .replace(DATE_TIME_NOISE, " ")
    .replace(/\b\d{6,}\b/g, " ")
    .replace(PAYMENT_RAIL_NOISE, " ")
    .replace(/[^A-Za-z0-9& ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  return normalized;
}

export function getMerchantRuleInput(
  transaction: Pick<Transaction, "description" | "merchant" | "type" | "sourceType">
): MerchantRuleMatchInput {
  return {
    merchantKey: buildMerchantKey(transaction.merchant || transaction.description),
    direction: transaction.type,
    // FIXME: Plan assumes direction: "any" for same merchant (purchase + refund same category)
    // Current: Separate rules for debit vs credit. This doubles rule count but may be more accurate.
    sourceType: transaction.sourceType ?? "any",
    // FIXME: Plan assumes sourceType: "any" (same merchant on CC and bank = same category)
    // Current: Separate rules for bank vs credit_card. May cause rule bloat.
  };
}

export function getMerchantRuleDecision(
  transaction: Pick<
    Transaction,
    "description" | "merchant" | "type" | "sourceType" | "category"
  >
): MerchantRuleDecision | null {
  const merchantKey = buildMerchantKey(transaction.merchant || transaction.description);
  if (!merchantKey) {
    return null;
  }

  return {
    merchantKey,
    categoryId: transaction.category.id,
    direction: transaction.type,
    sourceType: transaction.sourceType ?? "any",
    sampleDescription: transaction.description,
  };
}

function getSpecificityScore(
  rule: Pick<MerchantRule, "direction" | "sourceType">,
  input: MerchantRuleMatchInput
): number {
  const directionScore =
    rule.direction === input.direction ? 2 : rule.direction === "any" ? 1 : 0;
  const sourceTypeScore =
    rule.sourceType === input.sourceType ? 2 : rule.sourceType === "any" ? 1 : 0;

  return directionScore + sourceTypeScore;
}

export function findMatchingMerchantRule(
  rules: MerchantRule[],
  input: MerchantRuleMatchInput
): MerchantRule | null {
  const candidates = rules
    .filter(
      (rule) =>
        rule.merchantKey === input.merchantKey &&
        !rule.ambiguous &&
        (rule.direction === input.direction || rule.direction === "any") &&
        (rule.sourceType === input.sourceType || rule.sourceType === "any")
    )
    .sort(
      (a, b) =>
        getSpecificityScore(b, input) - getSpecificityScore(a, input) ||
        b.confirmations - a.confirmations ||
        b.lastConfirmedAt.localeCompare(a.lastConfirmedAt)
    );

  if (candidates.length === 0) {
    return null;
  }

  const best = candidates[0];
  const tied = candidates.filter(
    (rule) => getSpecificityScore(rule, input) === getSpecificityScore(best, input)
  );

  if (tied.some((rule) => rule.categoryId !== best.categoryId)) {
    return null;
  }

  return best;
}
