import { Category } from '@/models/Category';
import type { TransactionSubType } from '@/models/Transaction';
import { TransactionType } from '@/models/TransactionType';
import { assertNever } from '@/lib/utils/assertNever';

/**
 * The classification model (spec §3.2, §5, §5.1). Two authorities live here:
 *
 *  1. SUBTYPE_CATEGORIES — the M:N subtype→category map. Static, system-defined
 *     (categories are not user-created). Drives the review-UI dropdown cascade
 *     and the invalid_subtype_category review reason.
 *  2. roleOf — the per-transaction role (spending | income | excluded) derived
 *     from subtype + direction. Drives the Transaction role getters and routing.
 *
 * `refund` lists the union of the purchase/bank_charge/charge categories — a
 * refund keeps the category of what was refunded (the deciding M:N case).
 */
const PURCHASE_CATEGORY_IDS = [
  'groceries', 'dining', 'transportation', 'utilities', 'housing',
  'healthcare', 'entertainment', 'shopping', 'bills', 'insurance',
  'education', 'travel', 'other',
];

const SUBTYPE_CATEGORY_IDS: Record<Exclude<TransactionSubType, 'refund'>, readonly string[]> = {
  purchase: PURCHASE_CATEGORY_IDS,
  bank_charge: ['fees'],
  charge: ['fees', 'taxes'],
  income: ['income'],
  interest: ['interest'],
  rewards: ['cashback'],
  withdrawal: ['cash_withdrawal'],
  debt_payment: ['cc_bill_payment', 'loans'],
  investment: ['investment'],
  self_transfer: ['transfer'],
  adjustment: ['adjustment'],
};

/** Categories valid under a subtype. `refund` unions purchase/bank_charge/charge. */
export function categoriesFor(subType: TransactionSubType): Category[] {
  const ids =
    subType === 'refund'
      ? [
          ...SUBTYPE_CATEGORY_IDS.purchase,
          ...SUBTYPE_CATEGORY_IDS.bank_charge,
          ...SUBTYPE_CATEGORY_IDS.charge,
        ]
      : SUBTYPE_CATEGORY_IDS[subType as Exclude<TransactionSubType, 'refund'>];
  // Dedup: 'fees' is listed under both bank_charge and charge, so the refund
  // union would otherwise resolve it twice (and list it twice in the review
  // dropdown). The scalar branches have no internal duplicates.
  return [...new Set(ids)]
    .map((id) => Category.fromId(id))
    .filter((c): c is Category => Boolean(c));
}

/** Whether a (subtype, category) pair is reachable through the map (spec §3.2). */
export function isValidCombo(subType: TransactionSubType, categoryId: string): boolean {
  return categoriesFor(subType).some((c) => c.id === categoryId);
}

/**
 * The durable signal that a subtype was inferred from direction, not extracted
 * (spec §3.4). `llmConfidence: 0` is the marker; the `subtype_inferred` review
 * reason is derived from it later by the review layer, so it is not carried here.
 */
export interface InferredSubtype {
  transactionSubType: TransactionSubType;
  llmConfidence: number;
}

/**
 * Direction-default subtype for a deficient row (spec §3.4). The single source of
 * truth for the producer guarantee: `fromExtracted`/`fromJSON` (when the source
 * carries no subtype) and the CSV/XLS parsers (which have no LLM subtype) all go
 * through here. Returns the subtype plus `llmConfidence: 0` so callers record
 * honestly that the subtype is a guess, not an extracted fact.
 */
export function defaultSubtype(direction: TransactionType): InferredSubtype {
  return {
    transactionSubType: direction === TransactionType.Debit ? 'purchase' : 'income',
    llmConfidence: 0,
  };
}

export const ROLE = {
  SPENDING: 'spending',
  INCOME: 'income',
  EXCLUDED: 'excluded',
} as const;
export type Role = typeof ROLE[keyof typeof ROLE] | undefined;

/**
 * A transaction's role, derived from subtype + direction (spec §3.2). Category
 * is never consulted. `refund` has no gross role (it is an offset); returns
 * undefined so isExpense/isIncome/isExcluded are all false for a refund.
 */
export function roleOf(
  subType: TransactionSubType | undefined,
  direction: TransactionType,
): Role {
  if (!subType) return undefined;
  switch (subType) {
    case 'purchase':
    case 'bank_charge':
    case 'charge':
      return ROLE.SPENDING;
    case 'income':
    case 'rewards':
      return ROLE.INCOME;
    case 'interest':
    case 'adjustment':
      return direction === 'debit' ? ROLE.SPENDING : ROLE.INCOME;
    case 'self_transfer':
    case 'withdrawal':
    case 'debt_payment':
    case 'investment':
      return ROLE.EXCLUDED;
    case 'refund':
      return undefined;
    default:
      assertNever(subType);
  }
}
