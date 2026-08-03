import { test, expect } from '@playwright/test';
import { clearAllStorage } from '@tests/utils/storageHelpers';
import { setupTestContext } from '@tests/e2e/helpers/e2eHelpers';

/**
 * Regression for the restored-/review-tab hang. The review page stores its working state
 * in sessionStorage, which does not survive a browser close — so a restored /review tab
 * (system restart, browser crash, or a stale deep link) has no session and must redirect to
 * the dashboard instead of hanging on the loading screen forever.
 *
 * The redirect *logic* (empty session → router.push('/')) is pinned deterministically in
 * tests/unit/app/reviewPage.spec.tsx. This test guards the parts jsdom can't: the real
 * useSyncExternalStore hydration path (getServerSnapshot → client snapshot) and the real
 * Next.js router actually navigating away from /review.
 *
 * Generous timeout: under parallel e2e load the local dev server serves the dashboard's RSC
 * payload slowly; the redirect fires quickly but the URL swap waits on that payload.
 */

test.describe('Review page with no session', () => {
  test.beforeEach(async ({ context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
  });

  test('redirects to the dashboard instead of hanging on the loading screen', async ({ page }) => {
    await page.goto('/review');

    // Leaves /review and lands on the dashboard ("/"). Waits on the dashboard's RSC payload
    // under load, hence the wide timeout.
    await expect(page).toHaveURL(/\/$/, { timeout: 30000 });
  });
});
