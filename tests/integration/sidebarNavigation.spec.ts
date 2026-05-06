import { test, expect } from '@playwright/test';
import { setupTestContext, mockCategorizationAPI } from '../e2e/helpers/e2eHelpers';

test.describe('Sidebar navigation', () => {
  test.beforeEach(async ({ context }) => {
    await setupTestContext(context);
    await mockCategorizationAPI(context);
  });

  test('clicking nav items loads correct pages', async ({ page }) => {
    await page.goto('/');

    // Test Dashboard nav link specifically
    const dashboardLink = page.getByRole('link', { name: /dashboard|home/i }).or(page.getByRole('button', { name: /dashboard|home/i }));
    await expect(dashboardLink.first()).toBeVisible({ timeout: 5000 });
    await dashboardLink.first().click();
    await page.waitForURL(/\//, { timeout: 10000 });
    await expect(page.locator('body')).toBeVisible();

    // Test Transactions nav link
    const txnLink = page.getByRole('link', { name: /transactions/i }).or(page.getByRole('button', { name: /transactions/i }));
    await expect(txnLink.first()).toBeVisible({ timeout: 5000 });
    await txnLink.first().click();
    await page.waitForURL(/\/transactions/, { timeout: 10000 });
    await expect(page).toHaveURL(/\/transactions/);
  });

  test('upload button opens upload dialog', async ({ page }) => {
    await page.goto('/');
    const uploadBtn = page.getByRole('button', { name: /upload/i }).first();
    await expect(uploadBtn).toBeVisible({ timeout: 5000 });
    await uploadBtn.click();
    await expect(page.getByText(/upload.*statement|select.*file|drop.*file/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('sidebar is visible on desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const sidebar = page.locator('nav, [data-sidebar], aside').first();
    await expect(sidebar).toBeVisible({ timeout: 10000 });
  });

  test('navigation to chat page works', async ({ page }) => {
    await page.goto('/');
    const chatLink = page.getByRole('link', { name: /chat/i }).or(page.getByRole('button', { name: /chat/i }));
    await expect(chatLink.first()).toBeVisible({ timeout: 5000 });
    await chatLink.first().click();
    await page.waitForURL(/\/chat/, { timeout: 10000 });
    await expect(page).toHaveURL(/\/chat/);
  });
});
