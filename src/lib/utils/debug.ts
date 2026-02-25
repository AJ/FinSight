/**
 * Environment-aware logging utilities
 * Only outputs in development mode to prevent sensitive data leakage in production
 */

export function debugLog(...args: unknown[]): void {
  if (process.env.NODE_ENV === 'development') {
    console.log(...args);
  }
}

export function debugWarn(...args: unknown[]): void {
  if (process.env.NODE_ENV === 'development') {
    console.warn(...args);
  }
}

export function debugError(...args: unknown[]): void {
  // Errors are always logged, but consider using proper error tracking in production
  console.error(...args);
}
