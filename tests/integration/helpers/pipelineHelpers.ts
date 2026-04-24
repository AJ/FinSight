import * as fs from 'fs';
import * as path from 'path';

/**
 * Reusable helpers for integration tests
 */

export function loadFixture(filename: string): string {
  return fs.readFileSync(path.join(__dirname, '../../fixtures', filename), 'utf-8');
}

export function loadJsonFixture<T = unknown>(filename: string): T {
  return JSON.parse(loadFixture(filename)) as T;
}

export function validateTransactionSchema(tx: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!tx.date || isNaN(Date.parse(tx.date as string))) errors.push('invalid or missing date');
  if (typeof tx.amount !== 'number' || (tx.amount as number) < 0) errors.push('invalid amount');
  if (!['credit', 'debit'].includes(tx.type as string)) errors.push(`invalid type: ${tx.type}`);
  if (!tx.description || typeof tx.description !== 'string') errors.push('invalid description');
  if (tx.localCurrency && typeof tx.localCurrency !== 'string') errors.push('invalid localCurrency');
  return errors;
}

export function validateSummarySchema(summary: Record<string, unknown>, type: 'bank' | 'credit_card'): string[] {
  const errors: string[] = [];
  if (type === 'bank') {
    if (summary.openingBalance !== null && typeof summary.openingBalance !== 'number') errors.push('invalid openingBalance');
    if (summary.closingBalance !== null && typeof summary.closingBalance !== 'number') errors.push('invalid closingBalance');
  }
  if (type === 'credit_card') {
    if (summary.totalDue !== null && typeof summary.totalDue !== 'number') errors.push('invalid totalDue');
    if (summary.previousBalance !== null && typeof summary.previousBalance !== 'number') errors.push('invalid previousBalance');
  }
  return errors;
}

export function detectSilentFailures(inputCount: number, outputCount: number, warnings: string[]): { silent: boolean; details: string } {
  if (outputCount === 0 && warnings.length === 0) {
    return { silent: true, details: 'All data dropped without warning' };
  }
  if (outputCount < inputCount * 0.5 && warnings.length === 0) {
    return { silent: true, details: `>50% data lost without warning (${outputCount}/${inputCount})` };
  }
  return { silent: false, details: '' };
}