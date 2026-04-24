import { Page, BrowserContext } from '@playwright/test';

export async function getLocalStorage(page: Page, key: string): Promise<unknown> {
  await page.waitForLoadState('domcontentloaded');
  return await page.evaluate((k: string) => {
    try {
      const val = localStorage.getItem(k);
      return val ? JSON.parse(val) : null;
    } catch { return null; }
  }, key);
}

export async function setLocalStorage(page: Page, key: string, value: unknown): Promise<void> {
  await page.evaluate(({ k, v }: { k: string; v: unknown }) => {
    localStorage.setItem(k, JSON.stringify(v));
  }, { k: key, v: value });
}

export async function clearAllStorage(context: BrowserContext): Promise<void> {
  // Use context-level clearing which is often more reliable than page.evaluate
  await context.clearCookies();
  // Add init script to wipe storage on next navigation
  await context.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

export async function getTransactionsFromStorage(page: Page): Promise<Record<string, unknown>[]> {
  await page.waitForLoadState('domcontentloaded');
  const raw = await page.evaluate(() => localStorage.getItem('transaction-storage'));
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return parsed?.state?.transactions || parsed?.transactions || [];
  } catch { return []; }
}

export async function getReviewSessionTransactions(page: Page): Promise<Record<string, unknown>[]> {
  await page.waitForLoadState('domcontentloaded');
  const raw = await page.evaluate(() => sessionStorage.getItem('review-session-v1'));
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return parsed?.transactions || [];
  } catch { return []; }
}

export function validateTransactionShape(tx: Record<string, unknown>, index: number): string[] {
  const errors: string[] = [];
  if (!tx.id) errors.push(`Tx ${index}: missing id`);
  if (!tx.date) errors.push(`Tx ${index}: missing date`);
  if (typeof tx.amount !== 'number') errors.push(`Tx ${index}: amount is not a number`);
  if (!['credit', 'debit'].includes(tx.type as string)) errors.push(`Tx ${index}: invalid type "${tx.type}"`);
  if (!(tx.localCurrency as Record<string, unknown>)?.code) errors.push(`Tx ${index}: missing localCurrency`);
  return errors;
}