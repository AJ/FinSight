import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  findMatchingMerchantRule,
  MerchantRule,
  MerchantRuleDecision,
  MerchantRuleMatchInput,
} from "@/lib/categorization/merchantRules";

const MAX_MERCHANT_RULES = 1000;

interface MerchantRuleStoreState {
  rules: MerchantRule[];
  getRule: (input: MerchantRuleMatchInput) => MerchantRule | undefined;
  upsertRule: (decision: MerchantRuleDecision) => void;
  markAmbiguous: (
    merchantKey: string,
    direction: MerchantRuleMatchInput["direction"],
    sourceType: MerchantRuleMatchInput["sourceType"]
  ) => void;
  listRules: () => MerchantRule[];
}

function sortAndTrimRules(rules: MerchantRule[]): MerchantRule[] {
  return [...rules]
    .sort((a, b) => b.lastConfirmedAt.localeCompare(a.lastConfirmedAt))
    .slice(0, MAX_MERCHANT_RULES);
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
              rule.sourceType === decision.sourceType
          );

          if (matchIndex === -1) {
            return {
              rules: sortAndTrimRules([
                {
                  ...decision,
                  confirmations: 1,
                  lastConfirmedAt: now,
                },
                ...state.rules,
              ]),
            };
          }

          const existing = state.rules[matchIndex];
          const updatedRules = [...state.rules];

          if (existing.categoryId !== decision.categoryId) {
            updatedRules[matchIndex] = {
              ...existing,
              ambiguous: true,
              lastConfirmedAt: now,
              sampleDescription: decision.sampleDescription,
            };
            return {
              rules: sortAndTrimRules(updatedRules),
            };
          }

          updatedRules[matchIndex] = {
            ...existing,
            ambiguous: false,
            confirmations: existing.confirmations + 1,
            lastConfirmedAt: now,
            sampleDescription: decision.sampleDescription,
          };

          return {
            rules: sortAndTrimRules(updatedRules),
          };
        }),
      markAmbiguous: (merchantKey, direction, sourceType) =>
        set((state) => ({
          rules: state.rules.map((rule) =>
            rule.merchantKey === merchantKey &&
            rule.direction === direction &&
            rule.sourceType === sourceType
              ? { ...rule, ambiguous: true }
              : rule
          ),
        })),
      listRules: () => get().rules,
    }),
    {
      name: "merchant-rule-storage",
    }
  )
);

export const merchantRuleRepository = {
  getRule: (input: MerchantRuleMatchInput) =>
    useMerchantRuleStore.getState().getRule(input),
  upsertRule: (decision: MerchantRuleDecision) =>
    useMerchantRuleStore.getState().upsertRule(decision),
  markAmbiguous: (
    merchantKey: string,
    direction: MerchantRuleMatchInput["direction"],
    sourceType: MerchantRuleMatchInput["sourceType"]
  ) => useMerchantRuleStore.getState().markAmbiguous(merchantKey, direction, sourceType),
  listRules: () => useMerchantRuleStore.getState().listRules(),
};
