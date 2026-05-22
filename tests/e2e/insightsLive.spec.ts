import { test, expect } from '@playwright/test';
import {
  skipIfNoLiveLLM,
  seedLiveLLMSettings,
  seedTransactions,
  elapsedSince,
} from '@tests/e2e/helpers/liveTestHelpers';
import { clearAllStorage } from '@tests/utils/storageHelpers';

// Sample transactions for insights context — realistic data with clear spending patterns
const SAMPLE_TRANSACTIONS = Array.from({ length: 15 }, (_, i) => ({
  id: `test-insights-${i}`,
  date: `2025-08-${String(i + 1).padStart(2, '0')}`,
  description: [
    'AMAZON INDIA',
    'SWIGGY',
    'ZEPTO',
    'DMART',
    'UBER',
    'ELECTRICITY BILL',
    'NETFLIX',
    'SALARY CREDIT',
    'RENT PAYMENT',
    'PHONE RECHARGE',
    'FUEL',
    'GROCERY STORE',
    'PHARMACY',
    'RESTAURANT',
    'GYM MEMBERSHIP',
  ][i],
  amount: [1299, 450, 765, 907, 320, 2400, 649, 75000, 15000, 299, 3500, 1200, 380, 950, 2000][i],
  type: i === 7 ? 'credit' : 'debit',
  category: [
    'shopping',
    'dining',
    'dining',
    'groceries',
    'transportation',
    'utilities',
    'entertainment',
    'income',
    'housing',
    'utilities',
    'transportation',
    'groceries',
    'healthcare',
    'dining',
    'healthcare',
  ][i],
  localCurrency: { code: 'INR', symbol: '₹' },
}));

const VALID_INSIGHT_TYPES = new Set([
  'category_trend', 'day_pattern', 'merchant_insight',
  'anomaly', 'budget_alert', 'period_comparison', 'savings_opportunity',
]);

const VALID_SEVERITIES = new Set(['info', 'warning', 'positive']);

test.describe('Insights — Live LLM', () => {
  test.describe.configure({ mode: 'serial' });

  test('generates insights with valid structure referencing actual data', async ({ context, page }) => {
    skipIfNoLiveLLM();
    test.setTimeout(120_000);
    await clearAllStorage(context);
    await seedLiveLLMSettings(context);
    await seedTransactions(context, SAMPLE_TRANSACTIONS);

    const t0 = Date.now();

    await page.goto('/');
    console.log(`[insights] goto: ${elapsedSince(t0)}`);

    // Find and click the generate insights button
    const generateBtn = page.getByRole('button', { name: /generate insights/i });
    await expect(generateBtn).toBeVisible({ timeout: 10_000 });
    await generateBtn.click();
    console.log(`[insights] clicked generate: ${elapsedSince(t0)}`);

    // Wait for the success state — "Regenerate" button only appears after insights are generated.
    // (The loading state shows "Analyzing your spending patterns..." which contains "spending",
    // so matching on that text would falsely detect the loading state as success.)
    await expect(page.getByRole('button', { name: /regenerate/i })).toBeVisible({ timeout: 60_000 });
    console.log(`[insights] insights appeared: ${elapsedSince(t0)}`);

    // No error state
    await expect(page.getByText(/error|failed|unable/i)).not.toBeVisible();

    // Validate insight structure from the store
    const insights = await page.evaluate(() => {
      const raw = window.localStorage.getItem('insights-storage');
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return parsed?.state?.insights ?? null;
      } catch {
        return null;
      }
    });

    expect(insights).not.toBeNull();
    expect(Array.isArray(insights)).toBe(true);
    expect(insights!.length).toBeGreaterThan(0);

    for (const insight of insights!) {
      expect(VALID_INSIGHT_TYPES.has(insight.type)).toBe(true);
      expect(VALID_SEVERITIES.has(insight.severity)).toBe(true);
      expect(typeof insight.title).toBe('string');
      expect(insight.title.length).toBeGreaterThan(0);
      expect(typeof insight.description).toBe('string');
      expect(insight.description.length).toBeGreaterThan(0);
    }

    // Adversarial: at least one insight should reference actual transaction data
    // (categories, merchants, or amounts from the seeded data)
    const allText = insights!.map((i: { title: string; description: string }) =>
      `${i.title} ${i.description}`,
    ).join(' ').toLowerCase();

    const referencesRealData =
      allText.includes('shopping') ||
      allText.includes('dining') ||
      allText.includes('groceries') ||
      allText.includes('transportation') ||
      allText.includes('utilities') ||
      allText.includes('housing') ||
      allText.includes('salary') ||
      allText.includes('amazon') ||
      allText.includes('swiggy') ||
      allText.includes('1299') ||
      allText.includes('75000') ||
      allText.includes('15000');

    expect(
      referencesRealData,
      'No insight references actual seeded transaction data (categories, merchants, or amounts)',
    ).toBe(true);

    console.log(`[insights] ${insights!.length} valid insights, total: ${elapsedSince(t0)}`);
  });

  // ── Negative case: no transactions → dashboard shows empty state, no insights ──

  test('without transactions, dashboard shows empty state instead of insights', async ({ context, page }) => {
    skipIfNoLiveLLM();
    test.setTimeout(30_000);
    await clearAllStorage(context);
    await seedLiveLLMSettings(context);
    // Do NOT seed transactions

    await page.goto('/');

    // Dashboard should show empty state with upload prompt
    await expect(page.getByRole('heading', { name: /welcome to finsight/i })).toBeVisible({ timeout: 10_000 });

    // Insights content should NOT be visible (no "AI Spending Insights" heading)
    await expect(page.getByText(/ai spending insights|generate insights/i)).not.toBeVisible();
  });
});
