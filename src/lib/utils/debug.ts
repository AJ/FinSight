/**
 * Environment-aware logging utilities
 * Only outputs in development mode to prevent sensitive data leakage in production
 *
 * Set DEBUG_LOGGING=true in environment to enable verbose logging in production
 */

const isDebugEnabled = process.env.NODE_ENV === 'development' || process.env.DEBUG_LOGGING === 'true';

/**
 * Log debug information with optional stage context.
 * Overload 1: With stage prefix
 * @param stage - The stage/context of the log (e.g., 'cc_transactions', 'verification')
 * @param args - The data to log
 */
export function debugLog(stage: string, ...args: unknown[]): void;
/**
 * Log debug information without stage context (backward compatible).
 * Overload 2: Without stage prefix
 * @param args - The data to log
 * @deprecated Use the overload with stage prefix for better context in logs.
 */
//export function debugLog(...args: unknown[]): void;

/**
 * Implementation
 */
export function debugLog(stageOrArg: string | unknown, ...args: unknown[]): void {
  if (isDebugEnabled) {
    if (typeof stageOrArg === 'string') {
      console.log(`[${stageOrArg}]`, ...args);
    } else {
      console.log(stageOrArg, ...args);
    }
  }
}

/**
 * Log warnings with optional stage context.
 * Overload 1: With stage prefix
 */
export function debugWarn(stage: string, ...args: unknown[]): void;
/**
 * Log warnings without stage context (backward compatible).
 * Overload 2: Without stage prefix
 * @deprecated Use the overload with stage prefix for better context in logs.
 */
// export function debugWarn(...args: unknown[]): void;
/**
 * Implementation
 */
export function debugWarn(stageOrArg: string | unknown, ...args: unknown[]): void {
  if (isDebugEnabled) {
    if (typeof stageOrArg === 'string') {
      console.warn(`[${stageOrArg}]`, ...args);
    } else {
      console.warn(stageOrArg, ...args);
    }
  }
}

/**
 * Log errors with optional stage context. Errors are always logged.
 * Overload 1: With stage prefix
 */
export function debugError(stage: string, ...args: unknown[]): void;
/**
 * Log errors without stage context (backward compatible).
 * Overload 2: Without stage prefix
 * @deprecated Use the overload with stage prefix for better context in logs.
 */
// export function debugError(...args: unknown[]): void;
/**
 * Implementation
 */
export function debugError(stageOrArg: string | unknown, ...args: unknown[]): void {
  if (typeof stageOrArg === 'string') {
    console.error(`[${stageOrArg}]`, ...args);
  } else {
    console.error(stageOrArg, ...args);
  }
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
