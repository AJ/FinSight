/**
 * Environment-aware logging utilities
 * Only outputs in development mode to prevent sensitive data leakage in production
 *
 * Set DEBUG_LOGGING=true in environment to enable verbose logging in production
 */

const isDebugEnabled = process.env.NODE_ENV === 'development' || process.env.DEBUG_LOGGING === 'true';

export function debugLog(...args: unknown[]): void {
  if (isDebugEnabled) {
    console.log(...args);
  }
}

export function debugWarn(...args: unknown[]): void {
  if (isDebugEnabled) {
    console.warn(...args);
  }
}

export function debugError(...args: unknown[]): void {
  // Errors are always logged, but consider using proper error tracking in production
  console.error(...args);
}

/**
 * Log sensitive data only when DEBUG_LOGGING is explicitly enabled.
 * Use this for prompts, responses, and other potentially sensitive content.
 */
export function debugSensitive(label: string, data: unknown): void {
  if (process.env.DEBUG_LOGGING === 'true') {
    console.log(`[${label}]`, data);
  }
}
