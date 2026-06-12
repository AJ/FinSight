/**
 * Shared date-pattern detection for the parser pipeline.
 * Single source of truth for "does this text look like a date?"
 */

const DATE_DIGIT_SEP = /\d{1,2}[\/\-.]\d{1,2}/;
const DATE_MONTH_SEP = /\d{1,2}[\/\-\s.](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i;

export function isDateLike(text: string): boolean {
  return DATE_DIGIT_SEP.test(text) || DATE_MONTH_SEP.test(text);
}
