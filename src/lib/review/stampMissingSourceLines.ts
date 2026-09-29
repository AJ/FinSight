import type { Transaction } from '@/models/Transaction';
import type { StatementFormat } from '@/types';
import { addReason } from './reviewReasons';

/**
 * Row-identity spec §6: a PDF-extracted row where the model never echoed a line
 * number gets the advisory source_line_missing flag. CSV/XLS rows never carry a
 * sourceLine by design (deterministic parsers), so the stamp is gated on the
 * import format — those rows are never flagged.
 */
export function stampMissingSourceLines(
  transactions: Transaction[],
  format: StatementFormat,
): Transaction[] {
  if (format !== 'pdf') return transactions;
  return transactions.map((t) =>
    t.sourceLine === undefined
      ? t.cloneWith({ reviewReasons: addReason(t.reviewReasons, 'source_line_missing') })
      : t,
  );
}
