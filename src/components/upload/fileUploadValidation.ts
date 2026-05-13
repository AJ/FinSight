export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export const VALID_EXTENSIONS = ['.csv', '.pdf', '.xls', '.xlsx'] as const;

export const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  '.csv': ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
  '.pdf': ['application/pdf'],
  '.xls': ['application/vnd.ms-excel', 'application/msexcel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
};

export interface ValidationResult {
  valid: boolean;
  error: string | null;
}

export function getFileExtension(filename: string): string {
  return filename.toLowerCase().substring(filename.lastIndexOf('.'));
}

export function validateFile(file: { name: string; type: string; size: number }): ValidationResult {
  const ext = getFileExtension(file.name);

  if (!VALID_EXTENSIONS.includes(ext as typeof VALID_EXTENSIONS[number])) {
    return { valid: false, error: 'Please upload a valid file (CSV, PDF, XLS, or XLSX)' };
  }

  const allowedMimes = ALLOWED_MIME_TYPES[ext];
  if (file.type && allowedMimes && !allowedMimes.includes(file.type)) {
    return { valid: false, error: 'File content does not match its extension. Please upload a valid file.' };
  }

  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: 'File is too large. Maximum size is 10 MB.' };
  }

  return { valid: true, error: null };
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as Record<string, unknown>;
  const message = typeof err.message === 'string' ? (err.message as string).toLowerCase() : '';

  return (
    err.name === 'AbortError' ||
    message.includes('cancelled') ||
    message.includes('canceled')
  );
}

export function formatElapsedSeconds(startTime: number, now?: number): string {
  const ref = now ?? Date.now();
  return ((ref - startTime) / 1000).toFixed(2);
}
