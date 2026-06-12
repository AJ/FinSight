import { create } from "zustand";
import { persist } from "zustand/middleware";
import { debugLog } from "@/lib/utils/debug";
import {
  applyMerchantRuleDecision,
  findMatchingMerchantRule,
  isLegacyMerchantRule,
  migrateLegacyMerchantRule,
  MerchantRule,
  MerchantRuleDecision,
  MerchantRuleMatchInput,
} from "@/lib/categorization/merchantRules";

const MAX_MERCHANT_RULES = 1000;
const MERCHANT_RULE_STORE_VERSION = 1;

interface MerchantRuleStoreState {
  rules: MerchantRule[];
  getRule: (input: MerchantRuleMatchInput) => MerchantRule | undefined;
  upsertRule: (decision: MerchantRuleDecision) => void;
  listRules: () => MerchantRule[];
}

function sortAndTrimRules(rules: MerchantRule[]): MerchantRule[] {
  return [...rules]
    .sort((a, b) => b.lastConfirmedAt.localeCompare(a.lastConfirmedAt))
    .slice(0, MAX_MERCHANT_RULES);
}

function migratePersistedMerchantRuleState(
  persisted: unknown,
): Pick<MerchantRuleStoreState, "rules"> {
  const state = persisted as {
    rules?: unknown[];
  };

  const migratedRules = Array.isArray(state?.rules)
    ? state.rules
        .map((rule) =>
          isLegacyMerchantRule(rule) ? migrateLegacyMerchantRule(rule) : (rule as MerchantRule),
        )
        .filter(Boolean)
    : [];

  return {
    rules: sortAndTrimRules(migratedRules),
  };
}

export const useMerchantRuleStore = create<MerchantRuleStoreState>()(
  persist(
    (set, get) => ({
      rules: [],
      getRule: (input) => findMatchingMerchantRule(get().rules, input) ?? undefined,
      upsertRule: (decision) =>
        set((state) => {
          const now = new Date().toISOString();
          const matchIndex = state.rules.findIndex(
            (rule) =>
              rule.merchantKey === decision.merchantKey &&
              rule.direction === decision.direction &&
              rule.sourceType === decision.sourceType,
          );

          const isNew = matchIndex === -1;
          let updatedRule: ReturnType<typeof applyMerchantRuleDecision>;

          if (isNew) {
            updatedRule = applyMerchantRuleDecision(undefined, decision, now);
            debugLog('MerchantRules', '[UPSERTED]', {
              merchantKey: decision.merchantKey,
              isNew: true,
              status: updatedRule.status,
              activeCategoryId: updatedRule.activeCategoryId,
            });
            return {
              rules: sortAndTrimRules([updatedRule, ...state.rules]),
            };
          }

          updatedRule = applyMerchantRuleDecision(state.rules[matchIndex], decision, now);
          debugLog('MerchantRules', '[UPSERTED]', {
            merchantKey: decision.merchantKey,
            isNew: false,
            status: updatedRule.status,
            activeCategoryId: updatedRule.activeCategoryId,
            totalConfirmations: updatedRule.totalConfirmations,
          });

          const updatedRules = [...state.rules];
          updatedRules[matchIndex] = updatedRule;

          return {
            rules: sortAndTrimRules(updatedRules),
          };
        }),
      listRules: () => get().rules,
    }),
    {
      name: "merchant-rule-storage",
      version: MERCHANT_RULE_STORE_VERSION,
      migrate: (persisted) =>
        migratePersistedMerchantRuleState(persisted) as MerchantRuleStoreState,
    },
  ),
);
