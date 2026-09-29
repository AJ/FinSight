import type { StatementTableInfo } from './extraction/extractionTypes';
import { alignTableColumns } from './tableColumnAlignment';

/**
 * Row-identity line numbering (spec §2): prefix every line of the transactions
 * input with its 1-based line number followed by `||`. Applied to a LOCAL copy
 * inside runTransactionExtraction — no other pass ever sees numbered text.
 * Consumers may address line N of the original text as
 * `numberStatementLines(text).split('\n')[N - 1]`.
 */
export function numberStatementLines(text: string): string {
  return text
    .split('\n')
    .map((line, index) => `${index + 1}||${line}`)
    .join('\n');
}

/**
 * Credit-card request representation. Align repeated table layouts, then label
 * cell positions to make header/value associations explicit. Quote every cell
 * (including empty ones) without interpreting or dropping its contents.
 * Format BEFORE chunk planning so its extra tokens and echoed headers are
 * accounted for. Line count/order stay identical to the verification source.
 */
export function formatCreditCardTransactionInput(text: string, tables: StatementTableInfo[] = []): string {
  const indexed = alignTableColumns(text, tables).split('\n').map(line => line.includes('||')
    ? line.split('||').map((cell, index) => `[${index + 1}] ${JSON.stringify(cell)}`).join('||')
    : line);
  return numberStatementLines(indexed.join('\n'));
}
