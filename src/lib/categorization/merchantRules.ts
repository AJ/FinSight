import { normalizeMerchantName } from "@/lib/categorizer";
import type { SourceType, Transaction } from "@/types";
import { debugLog } from "@/lib/utils/debug";

export type MerchantRuleDirection = "credit" | "debit" | "any";
export type MerchantRuleSourceType = SourceType | "any";
export type MerchantRuleStatus = "confident" | "ambiguous";
export type MerchantRuleStatusReason =
  | "single-category"
  | "conflict"
  | "dominance-restored";

export const MERCHANT_RULE_MIN_CONFIRMATIONS = 3;
export const MERCHANT_RULE_MIN_LEAD = 2;

export interface MerchantRule {
  merchantKey: string;
  direction: MerchantRuleDirection;
  sourceType: MerchantRuleSourceType;
  categoryVotes: Record<string, number>;
  activeCategoryId?: string;
  status: MerchantRuleStatus;
  lastConfirmedCategoryId?: string;
  lastConfirmedAt: string;
  sampleDescription: string;
  totalConfirmations: number;
  runnerUpCategoryId?: string;
  statusReason?: MerchantRuleStatusReason;
}

export interface LegacyMerchantRule {
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
    return "__unknown__";
  }

  return normalizeMerchantName(rawText)
    .replace(/\([^)]*\)/g, " ")
    .replace(REF_NOISE, " ")
    .replace(DATE_TIME_NOISE, " ")
    .replace(/\b\d{6,}\b/g, " ")
    .replace(PAYMENT_RAIL_NOISE, " ")
    .replace(/[^A-Za-z0-9& ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function getMerchantRuleInput(
  transaction: Pick<Transaction, "description" | "merchant" | "type" | "sourceType">,
): MerchantRuleMatchInput {
  return {
    merchantKey: buildMerchantKey(transaction.merchant || transaction.description),
    direction: transaction.type,
    sourceType: transaction.sourceType ?? "any",
  };
}

export function getMerchantRuleDecision(
  transaction: Pick<
    Transaction,
    "description" | "merchant" | "type" | "sourceType" | "category"
  >,
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

export function isLegacyMerchantRule(rule: unknown): rule is LegacyMerchantRule {
  const candidate = rule as Partial<LegacyMerchantRule> & {
    categoryVotes?: unknown;
    totalConfirmations?: unknown;
  };

  return (
    typeof candidate?.merchantKey === "string" &&
    typeof candidate?.categoryId === "string" &&
    typeof candidate?.confirmations === "number" &&
    candidate?.categoryVotes === undefined &&
    candidate?.totalConfirmations === undefined
  );
}

export function migrateLegacyMerchantRule(legacyRule: LegacyMerchantRule): MerchantRule {
  const confirmations = Math.max(legacyRule.confirmations, 1);
  return {
    merchantKey: legacyRule.merchantKey,
    direction: legacyRule.direction,
    sourceType: legacyRule.sourceType,
    categoryVotes: {
      [legacyRule.categoryId]: confirmations,
    },
    activeCategoryId: legacyRule.ambiguous ? undefined : legacyRule.categoryId,
    status: legacyRule.ambiguous ? "ambiguous" : "confident",
    lastConfirmedCategoryId: legacyRule.categoryId,
    lastConfirmedAt: legacyRule.lastConfirmedAt,
    sampleDescription: legacyRule.sampleDescription,
    totalConfirmations: confirmations,
    runnerUpCategoryId: undefined,
    statusReason: legacyRule.ambiguous ? "conflict" : "single-category",
  };
}

export function applyMerchantRuleDecision(
  existingRule: MerchantRule | undefined,
  decision: MerchantRuleDecision,
  confirmedAt: string,
): MerchantRule {
  if (!existingRule) {
    return {
      merchantKey: decision.merchantKey,
      direction: decision.direction,
      sourceType: decision.sourceType,
      categoryVotes: {
        [decision.categoryId]: 1,
      },
      activeCategoryId: decision.categoryId,
      status: "confident",
      lastConfirmedCategoryId: decision.categoryId,
      lastConfirmedAt: confirmedAt,
      sampleDescription: decision.sampleDescription,
      totalConfirmations: 1,
      runnerUpCategoryId: undefined,
      statusReason: "single-category",
    };
  }

  const categoryVotes = {
    ...existingRule.categoryVotes,
    [decision.categoryId]: (existingRule.categoryVotes[decision.categoryId] ?? 0) + 1,
  };

  const totalConfirmations = Object.values(categoryVotes).reduce(
    (sum, count) => sum + count,
    0,
  );
  const resolvedState = resolveMerchantRuleState(categoryVotes);

  debugLog('MerchantRules', '[DISAMBIGUATION]', {
    merchantKey: existingRule.merchantKey,
    beforeStatus: existingRule.status,
    afterStatus: resolvedState.status,
    categoryId: decision.categoryId,
  });

  return {
    merchantKey: existingRule.merchantKey,
    direction: existingRule.direction,
    sourceType: existingRule.sourceType,
    categoryVotes,
    activeCategoryId: resolvedState.activeCategoryId,
    status: resolvedState.status,
    lastConfirmedCategoryId: decision.categoryId,
    lastConfirmedAt: confirmedAt,
    sampleDescription: decision.sampleDescription,
    totalConfirmations,
    runnerUpCategoryId: resolvedState.runnerUpCategoryId,
    statusReason: resolvedState.statusReason,
  };
}

function getSpecificityScore(
  rule: Pick<MerchantRule, "direction" | "sourceType">,
  input: MerchantRuleMatchInput,
): number {
  const directionScore =
    rule.direction === input.direction ? 2 : rule.direction === "any" ? 1 : 0;
  const sourceTypeScore =
    rule.sourceType === input.sourceType ? 2 : rule.sourceType === "any" ? 1 : 0;

  return directionScore + sourceTypeScore;
}

function getSortedCategoryVotes(categoryVotes: Record<string, number>): [string, number][] {
  return Object.entries(categoryVotes)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function resolveMerchantRuleState(categoryVotes: Record<string, number>): {
  activeCategoryId?: string;
  status: MerchantRuleStatus;
  runnerUpCategoryId?: string;
  statusReason: MerchantRuleStatusReason;
} {
  const sortedVotes = getSortedCategoryVotes(categoryVotes);
  const topVote = sortedVotes[0];
  const runnerUpVote = sortedVotes[1];

  if (!topVote) {
    return {
      activeCategoryId: undefined,
      status: "ambiguous",
      runnerUpCategoryId: undefined,
      statusReason: "conflict",
    };
  }

  if (!runnerUpVote) {
    return {
      activeCategoryId: topVote[0],
      status: "confident",
      runnerUpCategoryId: undefined,
      statusReason: "single-category",
    };
  }

  const lead = topVote[1] - runnerUpVote[1];
  if (
    topVote[1] >= MERCHANT_RULE_MIN_CONFIRMATIONS &&
    lead >= MERCHANT_RULE_MIN_LEAD
  ) {
    return {
      activeCategoryId: topVote[0],
      status: "confident",
      runnerUpCategoryId: runnerUpVote[0],
      statusReason: "dominance-restored",
    };
  }

  return {
    activeCategoryId: undefined,
    status: "ambiguous",
    runnerUpCategoryId: runnerUpVote[0],
    statusReason: "conflict",
  };
}

export function findMatchingMerchantRule(
  rules: MerchantRule[],
  input: MerchantRuleMatchInput,
): MerchantRule | null {
  const candidates = rules
    .filter(
      (rule) =>
        rule.merchantKey === input.merchantKey &&
        rule.status === "confident" &&
        !!rule.activeCategoryId &&
        (rule.direction === input.direction || rule.direction === "any") &&
        (rule.sourceType === input.sourceType || rule.sourceType === "any"),
    )
    .sort(
      (a, b) =>
        getSpecificityScore(b, input) - getSpecificityScore(a, input) ||
        b.totalConfirmations - a.totalConfirmations ||
        b.lastConfirmedAt.localeCompare(a.lastConfirmedAt),
    );

  if (candidates.length === 0) {
    return null;
  }

  const best = candidates[0];
  const tied = candidates.filter(
    (rule) => getSpecificityScore(rule, input) === getSpecificityScore(best, input),
  );

  if (tied.some((rule) => rule.activeCategoryId !== best.activeCategoryId)) {
    return null;
  }

  debugLog('MerchantRules', '[MATCH]', {
    inputKey: input.merchantKey,
    inputDirection: input.direction,
    candidateCount: candidates.length,
    selectedKey: best.merchantKey,
  });

  return best;
}
