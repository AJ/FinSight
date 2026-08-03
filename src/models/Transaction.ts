import { v4 as uuidv4 } from 'uuid';
import { TransactionType } from './TransactionType';
import { Category } from './Category';
import { CategorizedBy } from './CategorizedBy';
import { SourceType } from './SourceType';
import { AnomalyType } from './AnomalyType';
import { AnomalyDetails } from './AnomalyDetails';
import { Currency } from '@/types';
import { ExtractedTransaction } from '@/types/extractedTransaction';
import { getCurrencyByCode } from '@/lib/currencyFormatter';
import { roleOf, ROLE, defaultSubtype } from '@/lib/classification/subtypeCategories';
import type { ReviewReason } from '@/lib/review/reviewReasons';
import { REVIEW_REASONS } from '@/lib/review/reviewReasons';

// Transaction sub-types — the authoritative classifier (spec §4, 12 values).
// bank_charge (was `fee`) = bank/issuer charges; self_transfer (was `transfer`)
// = money between the user's own accounts; income = salary/general earnings.
export const TRANSACTION_SUB_TYPES = [
  'purchase', 'bank_charge', 'charge', 'refund', 'income',
  'interest', 'rewards', 'withdrawal', 'debt_payment',
  'investment', 'self_transfer', 'adjustment',
] as const;

export type TransactionSubType = typeof TRANSACTION_SUB_TYPES[number];

// SubTypes valid for each direction (spec §3.1 / §4 table).
export const DEBIT_SUB_TYPES: readonly TransactionSubType[] = [
  'purchase', 'bank_charge', 'charge', 'withdrawal', 'interest',
  'investment', 'debt_payment', 'self_transfer', 'adjustment',
];

export const CREDIT_SUB_TYPES: readonly TransactionSubType[] = [
  'interest', 'rewards', 'refund', 'income',
  'debt_payment', 'self_transfer', 'adjustment',
];

// Normalize legacy/extracted subtype names to the canonical set (spec §4).
const EXTRACTED_SUBTYPE_MAP: Record<string, TransactionSubType> = {
  payment: 'debt_payment',
  bill_payment: 'debt_payment',
  debt: 'debt_payment',
  deposit: 'self_transfer',
  transfer: 'self_transfer',
  transfer_in: 'self_transfer',
  transfer_out: 'self_transfer',
  fee: 'bank_charge',
  cashback: 'rewards',
  reversal: 'refund',
  reimbursement: 'refund',
};

// Canonical subtype set — used to reject non-canonical strings (e.g. an LLM-emitted
// "emi") before they reach roleOf, which throws on unknown values via assertNever.
const CANONICAL_SUB_TYPES: ReadonlySet<string> = new Set(TRANSACTION_SUB_TYPES);

function isCanonicalSubType(value: string): value is TransactionSubType {
  return CANONICAL_SUB_TYPES.has(value);
}

// Map a raw extracted/persisted subtype to a canonical one. Known LLM variants are
// translated via EXTRACTED_SUBTYPE_MAP; canonical values pass through unchanged;
// anything else (a hallucinated string like "emi") returns undefined so the caller
// falls back to a direction default instead of carrying a value that would crash
// roleOf. This is the parse-don't-cast boundary the `as TransactionSubType` casts in
// fromExtracted/fromJSON previously skipped.
function normalizeSubType(raw: string | undefined): TransactionSubType | undefined {
  if (!raw) return undefined;
  const mapped = EXTRACTED_SUBTYPE_MAP[raw] ?? raw;
  return isCanonicalSubType(mapped) ? mapped : undefined;
}

// Subtype definitions (spec §4). Direction is in parentheses; "either" means the
// subtype is valid in both directions, with direction picking the flavor.
//   purchase      (debit)  — buying goods/services; the core spending.
//   bank_charge   (debit)  — bank/issuer charges (late fee, annual fee, service fee).
//   charge        (debit)  — non-bank charges: taxes (GST/VAT/TDS) and forex/conversion (FCY, DCC).
//   refund        (credit) — money back for a returned purchase or charge.
//   income        (credit) — salary / general earnings.
//   interest      (either) — earned (credit) or charged (debit).
//   rewards       (credit) — money-credit rewards only: cashback, statement credit on redemption.
//   withdrawal    (debit)  — cash taken out at an ATM.
//   debt_payment  (either) — paying down a card or loan; debit on the bank side, credit on the card/loan side.
//   investment    (debit)  — money put into investments.
//   self_transfer (either) — money between the user's own accounts.
//   adjustment    (either) — bank correction / none-of-the-above.

export function formatSubType(subType: string): string {
  return subType.charAt(0).toUpperCase() + subType.slice(1).replace(/_/g, " ");
}

/**
 * JSON representation of a Transaction for serialization.
 * Category is stored as ID string; use Transaction.fromJSON() to restore.
 */
export interface TransactionJSON {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: TransactionType;
  category: string; // Category ID (look up via Category.fromId() to get Category object)
  balance?: number;
  merchant?: string;
  originalText?: string;
  budgetMonth?: string;
  categoryConfidence?: number;
  reviewReasons?: ReviewReason[];
  categorizedBy?: CategorizedBy;
  sourceType?: SourceType;
  statementId?: string;
  cardIssuer?: string;
  cardLastFour?: string;
  cardHolder?: string;
  localCurrency: Currency;       // Currency of the account/card (always set)
  originalCurrency?: Currency;    // Original currency for international transactions
  originalAmount?: number;        // Amount in original currency (for international)
  isInternational: boolean;       // True if this is an international transaction
  transactionSubType?: TransactionSubType;
  suggestedCategory?: string;     // LLM's category suggestion (used as initial category)
  isAnomaly?: boolean;
  anomalyTypes?: AnomalyType[];
  anomalyDetails?: AnomalyDetails;
  anomalyDismissed?: boolean;
  llmConfidence?: number;           // EXTRACTION confidence (TODO: rename to extractionConfidence — name predates the rework)
  verificationConfidence?: number;  // Our verification confidence (0.0-1.0)
  sourceFileHash?: string;          // SHA-256 hash of the source file for duplicate detection
}

/**
 * Transaction class representing a financial transaction.
 * Use Transaction.fromJSON() to deserialize from storage.
 */
export class Transaction {
  constructor(
    public readonly id: string,
    public readonly date: Date,
    public readonly description: string,
    public readonly amount: number,
    public readonly type: TransactionType,
    public category: Category,
    public readonly balance?: number,
    public readonly merchant?: string,
    public readonly originalText?: string,
    public readonly budgetMonth?: string,
    public categoryConfidence?: number,
    public categorizedBy?: CategorizedBy,
    public readonly sourceType?: SourceType,
    public readonly statementId?: string,
    public readonly cardIssuer?: string,
    public readonly cardLastFour?: string,
    public readonly cardHolder?: string,
    public readonly localCurrency: Currency = { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
    public readonly originalCurrency?: Currency,
    public readonly originalAmount?: number,
    public readonly isInternational: boolean = false,
    public isAnomaly?: boolean,
    public anomalyTypes?: AnomalyType[],
    public anomalyDetails?: AnomalyDetails,
    public anomalyDismissed?: boolean,
    // Transaction sub-type — the authoritative classifier (spec §4). Genuinely undefined
    // between extraction and the classification pass; classification guarantees a value
    // before return (defaultSubtype as its failure-path fallback). roleOf tolerates
    // undefined (returns role-unknown), so an unclassified transaction is safe. The
    // optional typing is now honest — not a ts(1016) workaround (thread #1).
    public readonly transactionSubType?: TransactionSubType,
    // LLM's suggested category (used as initial category, can be overridden)
    public readonly suggestedCategory?: string,
    // Confidence scores
    // EXTRACTION confidence — the extraction LLM's confidence in the transaction. Preserved
    // end-to-end (fromExtracted sets it; fromJSON must not clobber it). NOTE: applyCategorizationResults
    // sets this to 0 as the durable "subtype was inferred" signal when classification defaults the
    // subtype (applyVerificationReviewReasons converts 0 -> subtype_inferred). TODO: rename to
    // extractionConfidence and decouple the inferred-signal onto categoryConfidence so this field
    // is purely extraction quality and never a review-gate sentinel.
    public readonly llmConfidence?: number,
    public readonly verificationConfidence?: number,  // Our verification confidence (0.0-1.0)
    // Source file hash for duplicate detection
    public readonly sourceFileHash?: string,
    // Review reasons from the verification/categorization engines (spec §6). A row carries
    // ALL its reasons at once (hard + advisory can coexist). Empty = clean. Hard reasons are
    // staging-only and resolved before commit; advisories persist (§6.4).
    public readonly reviewReasons: ReviewReason[] = [],
  ) {}

  // Direction getters (from TransactionType)
  get isCredit(): boolean {
    return this.type === TransactionType.Credit;
  }
  get isDebit(): boolean {
    return this.type === TransactionType.Debit;
  }

  // Economic role getters — derived from transactionSubType (NOT the category).
  // Spec §3.2: category is never read to determine role.
  get isIncome(): boolean {
    return roleOf(this.transactionSubType, this.type) === ROLE.INCOME;
  }
  get isExpense(): boolean {
    return roleOf(this.transactionSubType, this.type) === ROLE.SPENDING;
  }
  get isExcluded(): boolean {
    return roleOf(this.transactionSubType, this.type) === ROLE.EXCLUDED;
  }

  // Signed amount for calculations (negative for debits)
  get signedAmount(): number {
    return this.isDebit ? -this.amount : this.amount;
  }

  toJSON(): TransactionJSON {
    return {
      id: this.id,
      date: this.date.toISOString(),
      description: this.description,
      amount: this.amount,
      type: this.type,
      category: this.category.id,
      balance: this.balance,
      merchant: this.merchant,
      originalText: this.originalText,
      budgetMonth: this.budgetMonth,
      categoryConfidence: this.categoryConfidence,
      reviewReasons: this.reviewReasons,
      categorizedBy: this.categorizedBy,
      sourceType: this.sourceType,
      statementId: this.statementId,
      cardIssuer: this.cardIssuer,
      cardLastFour: this.cardLastFour,
      cardHolder: this.cardHolder,
      localCurrency: this.localCurrency,
      originalCurrency: this.originalCurrency,
      originalAmount: this.originalAmount,
      isInternational: this.isInternational,
      transactionSubType: this.transactionSubType,
      suggestedCategory: this.suggestedCategory,
      isAnomaly: this.isAnomaly,
      anomalyTypes: this.anomalyTypes,
      anomalyDetails: this.anomalyDetails,
      anomalyDismissed: this.anomalyDismissed,
      llmConfidence: this.llmConfidence,
      verificationConfidence: this.verificationConfidence,
      sourceFileHash: this.sourceFileHash,
    };
  }

  /**
   * Create a new Transaction with specified field overrides.
   * Lighter than manual toJSON/fromJSON spread at call sites.
   */
  cloneWith(updates: Partial<TransactionJSON>): Transaction {
    return Transaction.fromJSON({ ...this.toJSON(), ...updates });
  }

  static fromJSON(json: TransactionJSON): Transaction {
    const category =
      Category.fromId(json.category) ?? Category.fromId(Category.DEFAULT_ID)!;

    // Load guarantee (spec §3.4): a row missing a subtype gets a direction default so one
    // always exists. The confidence is NOT clobbered here — json.llmConfidence (the extraction
    // confidence) is preserved as-is. The "subtype was inferred" signal is owned by the
    // classification pass: applyCategorizationResults sets llmConfidence 0 ONLY when it defaults
    // the subtype. Clobbering here used to destroy the extraction confidence for EVERY
    // pre-classification row (which has no subtype by design, D1), so every row read 0 and got
    // flagged subtype_inferred.
    // Persisted data can also carry a non-canonical subtype (a raw LLM string that
    // was never mapped); normalizeSubType rejects those so roleOf can't crash.
    const mappedSubType = normalizeSubType(json.transactionSubType);
    const fallback = defaultSubtype(json.type === 'credit' ? TransactionType.Credit : TransactionType.Debit);
    const inferred = {
      transactionSubType: mappedSubType ?? fallback.transactionSubType,
      llmConfidence: json.llmConfidence,
    };

    return new Transaction(
      json.id,
      new Date(json.date),
      json.description,
      Math.abs(json.amount),
      json.type,
      category,
      json.balance,
      json.merchant,
      json.originalText,
      json.budgetMonth,
      json.categoryConfidence,
      json.categorizedBy,
      json.sourceType,
      json.statementId,
      json.cardIssuer,
      json.cardLastFour,
      json.cardHolder,
      json.localCurrency ?? { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      json.originalCurrency,
      json.originalAmount,
      json.isInternational ?? false,
      json.isAnomaly,
      json.anomalyTypes,
      json.anomalyDetails,
      json.anomalyDismissed,
      inferred.transactionSubType, // load guarantee (spec §3.4): default when absent
      json.suggestedCategory,
      inferred.llmConfidence, // json.llmConfidence preserved (the extraction confidence)
      json.verificationConfidence,
      json.sourceFileHash,
      // Drop any reason no longer in the model. Persisted data (sessionStorage review
      // session, localStorage committed transactions) can carry reasons that were later
      // removed — e.g. math_reconciliation_failure, which became statement-level. Without
      // this filter, REVIEW_REASONS[r] is undefined downstream and the review row crashes.
      (json.reviewReasons ?? []).filter((r) => r in REVIEW_REASONS),
    );
  }
  /**
    * Create Transaction from LLM-extracted data.
    *
    * @param extracted - Raw LLM output (DTO)
    * @param settingsCurrency - User's configured currency
    * @param sourceType - Source of the transaction (Bank or Credit Card)
    * @returns New Transaction instance
    */
  static fromExtracted(
    extracted: ExtractedTransaction,
    settingsCurrency: Currency,
    sourceType: SourceType
    ): Transaction {
      const category = Category.fromId('other') ?? Category.fromId(Category.DEFAULT_ID)!;
      const txnType = extracted.type === 'credit' ? TransactionType.Credit : TransactionType.Debit;
      const extractedLocalCurrency = extracted.localCurrency
        ? getCurrencyByCode(String(extracted.localCurrency).trim().toUpperCase())
        : undefined;
      const extractedOriginalCurrency = extracted.originalCurrency
        ? getCurrencyByCode(String(extracted.originalCurrency).trim().toUpperCase())
        : undefined;

      // D1: extraction emits type only — NO subtype. The classification pass is the sole
      // subtype authority and guarantees a value before the transaction reaches verification
      // or storage (see applyCategorizationResults). llmConfidence here is the extraction
      // pass's confidence; classification sets it to 0 when it has to default the subtype
      // (the subtype_inferred signal).
      return new Transaction(
        uuidv4(), // id
        new Date(extracted.date), // date
        extracted.description, // description
        Math.abs(extracted.amount), // amount
        txnType, // type
        category, // category
        undefined, // balance
        undefined, // merchant
        extracted.description, // originalText
        undefined, // budgetMonth
        undefined, // categoryConfidence
        undefined, // categorizedBy
        sourceType, // sourceType
        undefined, // statementId
        undefined, // cardIssuer
        undefined, // cardLastFour
        undefined, // cardHolder
        extractedLocalCurrency ?? settingsCurrency, // localCurrency
        extractedOriginalCurrency, // originalCurrency
        extracted.originalAmount, // originalAmount
        extracted.isInternationalTransaction ?? false, // isInternational
        undefined, // isAnomaly
        undefined, // anomalyTypes
        undefined, // anomalyDetails
        undefined, // anomalyDismissed
        undefined, // transactionSubType — set by the classification pass (subtype authority)
        undefined, // suggestedCategory
        extracted.confidence, // extraction confidence (llmConfidence); preserved through the pipeline
        undefined // verificationConfidence
      );
   }
}
