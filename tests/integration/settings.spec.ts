import { test, expect } from '@playwright/test';
import { setupTestContext, mockCategorizationAPI } from '../e2e/helpers/e2eHelpers';

test.describe('Settings page', () => {
  test.beforeEach(async ({ context }) => {
    await setupTestContext(context);
    await mockCategorizationAPI(context);
  });

  test('renders with current settings', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText(/settings|preferences|provider/i)).toBeVisible({ timeout: 10000 });
  });

  test('shows LLM provider configuration', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText(/provider/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('shows currency selector', async ({ page }) => {
    await page.goto('/settings');
    // Currency UI must be present — this is a core setting
    await expect(page.getByText(/currency/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('clear all data button exists and is destructive variant', async ({ page }) => {
    await page.goto('/settings');
    const clearBtn = page.getByRole('button', { name: /clear.*data|reset|delete.*all/i });
    await expect(clearBtn).toBeVisible({ timeout: 5000 });
    // Must be a destructive/danger-styled button
    const classes = await clearBtn.getAttribute('class');
    expect(classes).toMatch(/destructive|danger|red/i);
  });

  test('connection status shows for configured provider', async ({ page }) => {
    await page.goto('/settings');
    // Connection status indicator must exist (connected or disconnected)
    await expect(page.getByText(/connected|disconnected|offline|unreachable|error/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('remote URL warning for non-localhost', async ({ page }) => {
    await page.goto('/settings');

    const urlInput = page.getByPlaceholder(/url|localhost/i).or(page.locator('input[type="url"]').first());
    await expect(urlInput).toBeVisible({ timeout: 5000 });
    await urlInput.clear();
    await urlInput.fill('http://remote-server.com:1234');

    // Should show a warning about remote URL
    await expect(page.getByText(/remote|warning|security|localhost/i).first()).toBeVisible({ timeout: 5000 });
  });
});
