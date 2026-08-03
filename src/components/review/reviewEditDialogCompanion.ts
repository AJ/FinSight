import { format } from "date-fns";
import { DEBIT_SUB_TYPES, CREDIT_SUB_TYPES, type TransactionSubType } from "@/models/Transaction";
// parseFormDate lives in the parse module; re-exported here to keep this companion's public
// surface stable for ReviewEditDialog and its tests.
export { parseFormDate } from "@/lib/parsers/dateParser";
import { isValidCombo } from "@/lib/classification/subtypeCategories";
import type { ReviewReason } from "@/lib/review/reviewReasons";

export function parseFormAmount(value: string): number | null {
  if (!value) return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

// min/max for the date input, matching the hard-reason validity window
// [2000-01-01, today]. Keeps free-typed dates (e.g. year 2520) out of the field.
export function dateInputBounds(): { min: string; max: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { min: "2000-01-01", max: format(today, "yyyy-MM-dd") };
}

// --- Date validity window (shared by the Save gate and the date-field border) ---

// Earliest accepted transaction date. Statements pre-2000 are treated as parse errors.
export const MIN_DATE = new Date("2000-01-01T00:00:00");

// Today floored to start-of-day: a transaction dated "today" stays valid while "tomorrow" is rejected.
export function maxAllowedDate(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isDateInRange(d: Date, now: Date = new Date()): boolean {
  const day = startOfDay(d);
  return day >= MIN_DATE && day <= maxAllowedDate(now);
}

// A Date is acceptable when it parses and falls in [MIN_DATE, today]. Shared by the
// hard-reason validator (Save gating) and the dialog's date-field border so the two
// never disagree on what counts as a valid date.
export function isFormDateValid(d: Date | null | undefined, now: Date = new Date()): boolean {
  return d instanceof Date && !isNaN(d.getTime()) && isDateInRange(d, now);
}

// --- Save-gate validator (validate-before-save) ---
// Pure function so the gating logic is unit-testable independently of the React component.

export interface DialogFormState {
  type: "debit" | "credit";
  amount: number;                       // may be NaN
  date: Date | null;                    // null when invalid
  transactionSubType: TransactionSubType | undefined;
  categoryId: string;                   // "" when blank
  llmConfidence: number | undefined;
  isForcedSelection: boolean;           // row carries a classification-decision reason
  hasInferred: boolean;                 // subtype_inferred on the original row
  hasSelfTransferUnresolved: boolean;   // self_transfer_unresolved on the original row
}

/**
 * Compute the HARD review reasons blocking save, against the dialog's live form
 * state. Advisories are never returned — they are never re-derived or cleared by
 * the dialog and ride through save unchanged.
 *
 * Two groups, cleared differently:
 *  - Data-deficiency (missing_or_invalid_field, subtype_direction_mismatch,
 *    invalid_subtype_category) are re-derived from the edited fields; each clears
 *    the instant its field is fixed.
 *  - Classification-decision (subtype_inferred, self_transfer_unresolved) are
 *    carried from the original row and clear once the user picks BOTH subtype and
 *    category (forced selection).
 *
 * invalid_subtype_category is skipped for an inferred subtype (llmConfidence 0):
 * pairing a dummy subtype with a category is the inference's fault, not a combo
 * error. This is safe in the dialog because the category cascade only ever offers
 * categories valid under the chosen subtype, so an invalid combo cannot be produced
 * through editing — only arrive via import.
 */
export function computeDialogHardReasons(form: DialogFormState): ReviewReason[] {
  const amountValid = typeof form.amount === "number" && isFinite(form.amount);
  const dateValid = isFormDateValid(form.date);
  const subtypeValid = !!form.transactionSubType;
  const categoryValid = !!form.categoryId;
  const bothPicked = subtypeValid && categoryValid;

  const hard: ReviewReason[] = [];

  // Data-deficiency reasons — re-derived from the edited fields.
  if (!amountValid || !dateValid) hard.push("missing_or_invalid_field");
  if (subtypeValid) {
    const validList = form.type === "debit" ? DEBIT_SUB_TYPES : CREDIT_SUB_TYPES;
    if (!validList.includes(form.transactionSubType as TransactionSubType)) {
      hard.push("subtype_direction_mismatch");
    }
    if (
      categoryValid &&
      form.llmConfidence !== 0 &&
      !isValidCombo(form.transactionSubType as TransactionSubType, form.categoryId)
    ) {
      hard.push("invalid_subtype_category");
    }
  }
  // Classification-decision reasons — cleared once the user picks both.
  if (form.hasInferred && !bothPicked) hard.push("subtype_inferred");
  if (form.hasSelfTransferUnresolved && !bothPicked) hard.push("self_transfer_unresolved");
  // A normal (non-forced) row whose subtype/category the user cleared is a missing field.
  if (!form.isForcedSelection && (!subtypeValid || !categoryValid) && !hard.includes("missing_or_invalid_field")) {
    hard.push("missing_or_invalid_field");
  }

  return hard;
}
