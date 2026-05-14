import { SourceType } from '@/models/SourceType';
import { getFileExtension } from './fileUploadValidation';

const MAX_PASSWORD_ATTEMPTS = 3;

export interface PasswordRetryResult {
  maxReached: boolean;
  remaining: number;
}

export function handlePasswordRetryResult(
  attempts: number,
  maxAttempts: number = MAX_PASSWORD_ATTEMPTS,
): PasswordRetryResult {
  const newAttempts = attempts + 1;
  const maxReached = newAttempts >= maxAttempts;
  return {
    maxReached,
    remaining: maxReached ? 0 : maxAttempts - newAttempts,
  };
}

export function classifyProcessingError(err: unknown, wasCancelled: boolean): string {
  if (wasCancelled) return 'cancelled';
  if (err instanceof Error) return err.message;
  return 'Failed to process file';
}

export function isAutoDetectAvailable(fileName: string | null): boolean {
  return !!fileName && getFileExtension(fileName) === '.pdf';
}

export function resolveDuplicateStatementType(sourceType: SourceType): 'credit_card' | 'bank' {
  return sourceType === SourceType.CreditCard ? 'credit_card' : 'bank';
}

export function formatProcessingSuccess(transactionCount: number, currencyCode?: string): string {
  const count = `${transactionCount} transaction${transactionCount !== 1 ? 's' : ''}`;
  return currencyCode ? `${count} (${currencyCode})` : count;
}
