import { test } from '@playwright/test';
import { waitForUploadCompletion } from '@tests/e2e/helpers/e2eHelpers';
import * as path from 'path';
import * as fs from 'fs';

// Load .env.test.live at import time so env vars are available without manual exports
const envPath = path.resolve(__dirname, '../../../.env.test.live');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

const LIVE_LLM_URL = process.env.LIVE_LLM_URL;
const LIVE_LLM_MODEL = process.env.LIVE_LLM_MODEL || 'qwen/qwen3-4b-2507';
const CC_PDF_PASSWORD = process.env.CC_PDF_PASSWORD || undefined;

export const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures');

export const VALID_CATEGORIES = new Set([
  'groceries', 'dining', 'transportation', 'utilities', 'housing',
  'healthcare', 'entertainment', 'shopping', 'income', 'interest',
  'cashback', 'transfer', 'bills', 'investment', 'insurance',
  'education', 'travel', 'fees', 'taxes', 'interest-expense', 'other',
]);

export const VALID_CATEGORY_SOURCES = new Set([
  'ai', 'rule', 'keyword', 'manual',
]);

export interface LiveLLMConfig {
  url: string;
  model: string;
  ccPassword?: string;
}

export function getLiveLLMConfig(): LiveLLMConfig {
  return {
    url: LIVE_LLM_URL || '',
    model: LIVE_LLM_MODEL,
    ccPassword: CC_PDF_PASSWORD,
  };
}

export function skipIfNoLiveLLM(): void {
  test.skip(!LIVE_LLM_URL, 'LIVE_LLM_URL not set — skipping real LLM tests');
}

export async function seedLiveLLMSettings(
  context: import('@playwright/test').BrowserContext,
  overrides?: { url?: string; model?: string },
): Promise<void> {
  const config = getLiveLLMConfig();
  await context.addInitScript(
    ({ url, model }) => {
      window.localStorage.setItem(
        'onboarding-storage',
        JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 1 }),
      );
      window.localStorage.setItem(
        'settings-storage',
        JSON.stringify({
          state: { llmProvider: 'lmstudio', llmServerUrl: url, llmModel: model },
          version: 1,
        }),
      );
    },
    { url: overrides?.url ?? config.url, model: overrides?.model ?? config.model },
  );
}

export interface ReviewSession {
  transactions: Array<Record<string, unknown>>;
  verificationReport?: Record<string, unknown>;
  currency?: Record<string, unknown>;
  statementSummary?: Record<string, unknown> | null;
  statementType?: string;
}

export async function getReviewSession(
  page: import('@playwright/test').Page,
): Promise<ReviewSession | null> {
  await page.waitForLoadState('domcontentloaded');
  const raw = await page.evaluate(() => window.sessionStorage.getItem('review-session-v1'));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Like waitForUploadCompletion, but fails fast when the pipeline completes
 * without navigating to /review (e.g., wrong PDF password, extraction failure).
 */
export async function waitForUploadOrFailure(
  page: import('@playwright/test').Page,
  timeout: number,
): Promise<void> {
  let pipelineCompleted = false;
  const handler = (msg: import('@playwright/test').ConsoleMessage) => {
    if (msg.text().includes('[FileProcessor] Processing completed')) {
      pipelineCompleted = true;
    }
  };
  page.on('console', handler);

  try {
    await waitForUploadCompletion(page, timeout);
  } catch (err) {
    if (pipelineCompleted) {
      throw new Error(
        'Pipeline completed without navigating to /review. ' +
          'Likely cause: incorrect PDF password or extraction failure.',
      );
    }
    throw err;
  } finally {
    page.off('console', handler);
  }
}

export function setupConsoleCapture(page: import('@playwright/test').Page): string[] {
  const consoleLogs: string[] = [];
  page.on('console', (msg) => {
    const prefix = msg.type() === 'error' ? 'ERR' : msg.type() === 'warning' ? 'WRN' : 'LOG';
    consoleLogs.push(`[${prefix}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    consoleLogs.push(`[PAGE_ERROR] ${err.message}\n${err.stack}`);
  });
  page.on('requestfailed', (request) => {
    consoleLogs.push(
      `[REQUEST_FAILED] ${request.method()} ${request.url()} -- ${request.failure()?.errorText}`,
    );
  });
  page.on('response', async (response) => {
    if (response.status() >= 400 && response.url().includes('/v1/')) {
      try {
        const body = await response.text();
        consoleLogs.push(
          `[HTTP_${response.status()}] ${response.url()}\n  Body: ${body.slice(0, 2000)}`,
        );
      } catch {
        consoleLogs.push(`[HTTP_${response.status()}] ${response.url()} -- could not read body`);
      }
    }
  });
  return consoleLogs;
}

export function dumpLogsOnFailure(consoleLogs: string[], err: unknown, label: string): never {
  const logPath = path.join(FIXTURES_DIR, '..', `${label}-pipeline-debug.log`);
  fs.writeFileSync(logPath, consoleLogs.join('\n'));
  throw new Error(
    `${label} pipeline stalled. Logs written to ${logPath}\n\nLast 20 logs:\n${consoleLogs.slice(-20).join('\n')}\n\n${err}`,
  );
}

/**
 * Seeds transactions into localStorage via context.addInitScript.
 * Must be called BEFORE page.goto() so data is available when Zustand hydrates.
 */
export async function seedTransactions(
  context: import('@playwright/test').BrowserContext,
  transactions: Array<Record<string, unknown>>,
): Promise<void> {
  await context.addInitScript(
    (txns) => {
      window.localStorage.setItem(
        'transaction-storage',
        JSON.stringify({ state: { transactions: txns }, version: 0 }),
      );
    },
    transactions,
  );
}

/** Reads transactions from localStorage (post-review saved state). */
export async function getTransactionsFromStore(
  page: import('@playwright/test').Page,
): Promise<Array<Record<string, unknown>>> {
  const raw = await page.evaluate(() => window.localStorage.getItem('transaction-storage'));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return parsed?.state?.transactions ?? [];
  } catch {
    return [];
  }
}

/** Reads merchant rules from localStorage (Zustand persist envelope). */
export async function getMerchantRules(
  page: import('@playwright/test').Page,
): Promise<Array<Record<string, unknown>>> {
  const raw = await page.evaluate(() => window.localStorage.getItem('merchant-rule-storage'));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return parsed?.state?.rules ?? [];
  } catch {
    return [];
  }
}

/** Timing helper for logging test step durations. */
export function elapsedSince(start: number): string {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}
