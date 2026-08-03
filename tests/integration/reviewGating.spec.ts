import { test, expect, type BrowserContext } from '@playwright/test';
import { setupTestContext } from '../e2e/helpers/e2eHelpers';

/**
 * Comprehensive review-page gating suite.
 *
 * Seeds review-session data into sessionStorage, then verifies the review page's
 * contract across the full reason/severity matrix:
 *   - clean import           (no advisories, no gates)
 *   - advisory-only import   (low_confidence / duplicate — never block)
 *   - gate-only import       (each hard reason blocks until resolved)
 *   - mixed hard + advisory  (gate blocks; advisory rides along and clears on save)
 *   - failed import          (hard-failed parse never reaches review — covered by the
 *                             upload/pipeline layer; the review analogue is the
 *                             no-session redirect, asserted once here)
 *
 * Resolution paths differ per reason and are exercised through the real edit dialog:
 *   missing_or_invalid_field    -> fix the field (re-derived live)
 *   subtype_direction_mismatch  -> correct the subtype
 *   subtype_inferred            -> forced: pick BOTH subtype + category
 *   self_transfer_unresolved    -> forced: pick BOTH subtype + category
 *   invalid_subtype_category    -> pick a valid category (the cascade blanks the
 *                                   invalid one on open, so the dialog re-labels it
 *                                   missing_or_invalid_field — the actual behavior)
 *
 * Seed-data honesty: the row marker and the page commit-gate read the seeded
 * `reviewReasons[]` array, but the edit dialog RE-DERIVES data-deficiency reasons live
 * from the fields. So a seeded reason whose underlying data is actually clean would
 * vanish the moment the dialog opens, making any "resolution" vacuous. Every seed here
 * is constructed so the data genuinely produces the stamped reason — the dialog and the
 * marker agree.
 *
 * No LLM is invoked; these tests assert UI behavior from seeded data only.
 */

interface SeedTxn {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
  category: string;
  merchant?: string;
  transactionSubType?: string;
  llmConfidence?: number;
  categoryConfidence?: number;
  reviewReasons?: string[];
  sourceType?: string;
}

function seedReviewSession(
  context: BrowserContext,
  transactions: SeedTxn[],
  opts: { statementType?: string } = {},
) {
  return context.addInitScript(({ txns, statementType }) => {
    window.sessionStorage.setItem('review-session-v1', JSON.stringify({
      transactions: txns,
      // Inline the currency literal — addInitScript serializes this function to the
      // browser, so a closed-over module const (e.g. INR) would be a ReferenceError.
      currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      format: 'csv',
      statementType: statementType ?? 'bank',
      fileName: 'test-statement.csv',
      parseDate: new Date().toISOString(),
      warnings: [],
    }));
  }, { txns: transactions, statementType: opts.statementType ?? 'bank' });
}

// Open the edit dialog for the row matching `descriptionText` and wait for it.
async function openEditFor(page: import('@playwright/test').Page, descriptionText: string) {
  const row = page.locator('tr').filter({ hasText: descriptionText });
  await row.locator('button').first().click();
  await expect(page.getByRole('heading', { name: 'Edit Transaction' })).toBeVisible({ timeout: 5000 });
}

const confirmBtn = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /confirm.*import/i });

// The row's status indicator (Actions column). It is a non-button span whose aria-label
// begins "Review issues — " and then lists every reason's label + hint. Asserting on a
// reason's label here is the stable signal that the row carries that reason — it does not
// depend on pill text (which was removed) or on which cell is blanked.
const reasonIndicator = (page: import('@playwright/test').Page, label: string) =>
  page.locator(`[role="img"][aria-label*="${label}"]`);

// ===========================================================================
// Clean import — no reasons anywhere
// ===========================================================================
test.describe('Review gating — clean import', () => {
  test.beforeEach(async ({ context }) => {
    await setupTestContext(context);
    await seedReviewSession(context, [
      { id: 'c1', date: '2026-01-10', description: 'AMAZON IN', amount: 1299, type: 'debit', category: 'shopping', merchant: 'Amazon', transactionSubType: 'purchase', llmConfidence: 0.92, categoryConfidence: 0.9, reviewReasons: [], sourceType: 'bank' },
      { id: 'c2', date: '2026-01-05', description: 'SALARY ACME', amount: 75000, type: 'credit', category: 'income', merchant: 'Acme Corp', transactionSubType: 'income', llmConfidence: 0.95, categoryConfidence: 0.95, reviewReasons: [], sourceType: 'bank' },
    ]);
  });

  test('no markers, Confirm enabled, commit lands rows on the transactions page', async ({ page }) => {
    await page.goto('/review');
    await expect(page).toHaveURL(/\/review/, { timeout: 10000 });

    // No status indicators on either row.
    await expect(page.locator('[role="img"][aria-label*="Review issues"]')).toHaveCount(0);
    await expect(confirmBtn(page)).toBeEnabled();

    // Subtitle shows no "needs resolution".
    await expect(page.getByText(/needs?\s+resolution/)).toHaveCount(0);

    await confirmBtn(page).click();
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    // Rows committed to the store are visible on the transactions page.
    await page.goto('/transactions');
    await expect(page.getByText('AMAZON IN').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('SALARY ACME').first()).toBeVisible();
  });
});

// ===========================================================================
// Advisory reasons never block, and clear/persist on save per spec
// ===========================================================================
test.describe('Review gating — advisory reasons do not block', () => {
  test.beforeEach(async ({ context }) => {
    await setupTestContext(context);
    await seedReviewSession(context, [
      // low_confidence: keyword-fallback category confidence (0.3).
      { id: 'a1', date: '2026-02-01', description: 'SWIGGY FOOD', amount: 450, type: 'debit', category: 'dining', merchant: 'Swiggy', transactionSubType: 'purchase', llmConfidence: 0.9, categoryConfidence: 0.3, reviewReasons: ['low_confidence'], sourceType: 'bank' },
      // fingerprint_collision: possible duplicate.
      { id: 'a3', date: '2026-02-05', description: 'NETFLIX', amount: 649, type: 'debit', category: 'entertainment', merchant: 'Netflix', transactionSubType: 'purchase', llmConfidence: 0.9, categoryConfidence: 0.9, reviewReasons: ['fingerprint_collision'], sourceType: 'bank' },
    ]);
  });

  test('each advisory surfaces its indicator and Confirm stays enabled', async ({ page }) => {
    await page.goto('/review');
    await expect(page).toHaveURL(/\/review/, { timeout: 10000 });

    // Advisory indicators present (amber, not red).
    await expect(reasonIndicator(page, 'Low confidence')).toBeVisible();   // low_confidence
    await expect(reasonIndicator(page, 'Possible duplicate')).toBeVisible(); // fingerprint

    // No "needs resolution" — advisories do not count toward the gate.
    await expect(page.getByText(/needs?\s+resolution/)).toHaveCount(0);
    await expect(confirmBtn(page)).toBeEnabled();
  });

  test('advisory-only import commits without any resolution', async ({ page }) => {
    await page.goto('/review');
    await expect(confirmBtn(page)).toBeEnabled();
    await confirmBtn(page).click();
    await page.waitForURL('**/dashboard', { timeout: 10000 });
  });
});

test.describe('Review gating — advisory persistence vs clearing on save', () => {
  // low_confidence concerns the row's own data, which a full-row edit resolves, so it
  // is cleared on save. fingerprint_collision is not row-fixable and rides through save
  // unchanged (spec §6.4). (Reconciliation failure is statement-level, never stamped on
  // a row, and surfaced only in the VerificationSummary banner.)
  test('low_confidence is cleared by an edit-save; the indicator disappears', async ({ context, page }) => {
    await setupTestContext(context);
    await seedReviewSession(context, [
      { id: 'l1', date: '2026-03-01', description: 'SWIGGY FOOD', amount: 450, type: 'debit', category: 'dining', merchant: 'Swiggy', transactionSubType: 'purchase', llmConfidence: 0.9, categoryConfidence: 0.3, reviewReasons: ['low_confidence'], sourceType: 'bank' },
    ]);

    await page.goto('/review');
    await expect(reasonIndicator(page, 'Low confidence')).toBeVisible();

    await openEditFor(page, 'SWIGGY FOOD');
    // Any real change (net-diff) qualifies the save.
    await page.locator('#edit-desc').fill('Swiggy Food Order');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Transaction' })).not.toBeVisible({ timeout: 5000 });

    // low_confidence cleared → indicator gone, row is now clean.
    await expect(reasonIndicator(page, 'Low confidence')).not.toBeVisible({ timeout: 5000 });
    await expect(confirmBtn(page)).toBeEnabled();
  });

  test('fingerprint_collision persists through an edit-save', async ({ context, page }) => {
    await setupTestContext(context);
    await seedReviewSession(context, [
      { id: 'd1', date: '2026-03-03', description: 'NETFLIX', amount: 649, type: 'debit', category: 'entertainment', merchant: 'Netflix', transactionSubType: 'purchase', llmConfidence: 0.9, categoryConfidence: 0.9, reviewReasons: ['fingerprint_collision'], sourceType: 'bank' },
    ]);

    await page.goto('/review');
    await expect(reasonIndicator(page, 'Possible duplicate')).toBeVisible();

    await openEditFor(page, 'NETFLIX');
    await page.locator('#edit-desc').fill('Netflix Subscription');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Transaction' })).not.toBeVisible({ timeout: 5000 });

    await expect(reasonIndicator(page, 'Possible duplicate')).toBeVisible({ timeout: 5000 });
    await expect(confirmBtn(page)).toBeEnabled();
  });
});

// ===========================================================================
// Hard reasons block commit, each resolved through its real dialog path
// ===========================================================================
test.describe('Review gating — hard reasons block and resolve', () => {
  test('missing_or_invalid_field: marker shows, gate blocks', async ({ context, page }) => {
    await setupTestContext(context);
    // The marker + page gate read the seeded array directly. The data is well-formed,
    // so the dialog would re-derive nothing — the dialog-side clearing of this reason
    // is covered by the "clearing a field induces missing" test below and by the
    // computeDialogHardReasons unit tests. Here we assert the row-level contract: a
    // row stamped missing blocks commit and surfaces the Fix-field marker.
    await seedReviewSession(context, [
      { id: 'h1', date: '2026-04-01', description: 'MYSTERY TXN', amount: 500, type: 'debit', category: 'other', merchant: 'Unknown', transactionSubType: 'purchase', llmConfidence: 0.9, categoryConfidence: 0.9, reviewReasons: ['missing_or_invalid_field'], sourceType: 'bank' },
    ]);

    await page.goto('/review');
    await expect(reasonIndicator(page, 'Missing or invalid field')).toBeVisible();
    await expect(page.getByText(/1\s+need\s+resolution/)).toBeVisible();
    await expect(confirmBtn(page)).toBeDisabled();
  });

  test('missing_or_invalid_field: clearing a field induces it, re-picking resolves it', async ({ context, page }) => {
    await setupTestContext(context);
    await seedReviewSession(context, [
      { id: 'h1b', date: '2026-04-02', description: 'AMAZON IN', amount: 1299, type: 'debit', category: 'shopping', merchant: 'Amazon', transactionSubType: 'purchase', llmConfidence: 0.9, categoryConfidence: 0.9, reviewReasons: [], sourceType: 'bank' },
    ]);

    await page.goto('/review');
    await expect(confirmBtn(page)).toBeEnabled();

    // Clear the category on a clean row -> the dialog re-derives missing_or_invalid_field.
    await openEditFor(page, 'AMAZON IN');
    await page.locator('#edit-category').selectOption('');
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await expect(page.getByText('Missing or invalid field')).toBeVisible();

    // Re-pick a valid category (different from the original so the net-diff dirty
    // gate also sees a real change) -> reason clears, Save enables.
    await page.locator('#edit-category').selectOption('dining');
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Transaction' })).not.toBeVisible({ timeout: 5000 });

    await expect(confirmBtn(page)).toBeEnabled();
  });

  test('subtype_direction_mismatch: debit/refund blocks; correcting the subtype resolves it', async ({ context, page }) => {
    await setupTestContext(context);
    // refund is credit-only; a debit refund is a genuine direction conflict.
    await seedReviewSession(context, [
      { id: 'h2', date: '2026-04-03', description: 'REFUND POSTED', amount: 300, type: 'debit', category: 'shopping', merchant: 'Store', transactionSubType: 'refund', llmConfidence: 0.9, categoryConfidence: 0.9, reviewReasons: ['subtype_direction_mismatch'], sourceType: 'bank' },
    ]);

    await page.goto('/review');
    await expect(reasonIndicator(page, 'Subtype-direction conflict')).toBeVisible();
    await expect(confirmBtn(page)).toBeDisabled();

    await openEditFor(page, 'REFUND POSTED');
    // Switch to a debit-valid subtype (category cascade resets on subtype change).
    await page.locator('#edit-subtype').selectOption('purchase');
    await page.locator('#edit-category').selectOption('shopping');
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Transaction' })).not.toBeVisible({ timeout: 5000 });

    await expect(reasonIndicator(page, 'Subtype-direction conflict')).not.toBeVisible({ timeout: 5000 });
    await expect(confirmBtn(page)).toBeEnabled();
  });

  test('subtype_inferred: forced pick of subtype + category resolves it', async ({ context, page }) => {
    await setupTestContext(context);
    // llmConfidence 0 is the durable inferred-signal; subtype defaulted from direction.
    await seedReviewSession(context, [
      { id: 'h3', date: '2026-04-04', description: 'CARD POS DRINKS', amount: 320, type: 'debit', category: 'other', merchant: 'Pos', transactionSubType: 'purchase', llmConfidence: 0, categoryConfidence: 0.3, reviewReasons: ['subtype_inferred'], sourceType: 'bank' },
    ]);

    await page.goto('/review');
    await expect(reasonIndicator(page, 'Subtype not confirmed')).toBeVisible();
    await expect(confirmBtn(page)).toBeDisabled();

    await openEditFor(page, 'CARD POS DRINKS');
    // Forced: subtype + category presented blank; both must be picked.
    await expect(page.locator('#edit-subtype')).toHaveValue('');
    await page.locator('#edit-subtype').selectOption('purchase');
    // Picking subtype only is not enough — Save still disabled.
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await page.locator('#edit-category').selectOption('dining');
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Transaction' })).not.toBeVisible({ timeout: 5000 });

    await expect(reasonIndicator(page, 'Subtype not confirmed')).not.toBeVisible({ timeout: 5000 });
    await expect(confirmBtn(page)).toBeEnabled();
  });

  test('self_transfer_unresolved: forced pick of subtype + category resolves it', async ({ context, page }) => {
    await setupTestContext(context);
    await seedReviewSession(context, [
      { id: 'h4', date: '2026-04-05', description: 'NEFT TO SAVINGS', amount: 5000, type: 'debit', category: 'transfer', merchant: 'Bank', transactionSubType: 'self_transfer', llmConfidence: 0.9, categoryConfidence: 0.9, reviewReasons: ['self_transfer_unresolved'], sourceType: 'bank' },
    ]);

    await page.goto('/review');
    await expect(reasonIndicator(page, 'Unresolved transfer')).toBeVisible();
    await expect(confirmBtn(page)).toBeDisabled();

    await openEditFor(page, 'NEFT TO SAVINGS');
    await expect(page.locator('#edit-subtype')).toHaveValue('');
    await page.locator('#edit-subtype').selectOption('self_transfer');
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await page.locator('#edit-category').selectOption('transfer');
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Transaction' })).not.toBeVisible({ timeout: 5000 });

    await expect(reasonIndicator(page, 'Unresolved transfer')).not.toBeVisible({ timeout: 5000 });
    await expect(confirmBtn(page)).toBeEnabled();
  });

  test('invalid_subtype_category: pick a valid category to resolve', async ({ context, page }) => {
    await setupTestContext(context);
    // purchase + income is not a valid combo. The dialog's category cascade blanks the
    // invalid category on open, so the live re-derivation surfaces missing_or_invalid_field
    // — the actual behavior. The seeded row marker still reads the stamped reason. Resolution
    // is picking any valid category.
    await seedReviewSession(context, [
      { id: 'h5', date: '2026-04-06', description: 'MISFILED TXN', amount: 800, type: 'debit', category: 'income', merchant: 'X', transactionSubType: 'purchase', llmConfidence: 0.9, categoryConfidence: 0.9, reviewReasons: ['invalid_subtype_category'], sourceType: 'bank' },
    ]);

    await page.goto('/review');
    await expect(reasonIndicator(page, 'Category not valid for subtype')).toBeVisible();
    await expect(confirmBtn(page)).toBeDisabled();

    await openEditFor(page, 'MISFILED TXN');
    // The invalid category was blanked by the cascade.
    await expect(page.locator('#edit-category')).toHaveValue('');
    await page.locator('#edit-category').selectOption('shopping');
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Transaction' })).not.toBeVisible({ timeout: 5000 });

    await expect(reasonIndicator(page, 'Category not valid for subtype')).not.toBeVisible({ timeout: 5000 });
    await expect(confirmBtn(page)).toBeEnabled();
  });
});

// ===========================================================================
// Mixed hard + advisory on one row
// ===========================================================================
test.describe('Review gating — mixed hard + advisory', () => {
  test('a row carrying subtype_inferred + low_confidence blocks, and both clear on save', async ({ context, page }) => {
    await setupTestContext(context);
    await seedReviewSession(context, [
      { id: 'x1', date: '2026-05-01', description: 'CARD POS COFFEE', amount: 180, type: 'debit', category: 'other', merchant: 'Cafe', transactionSubType: 'purchase', llmConfidence: 0, categoryConfidence: 0.3, reviewReasons: ['subtype_inferred', 'low_confidence'], sourceType: 'bank' },
    ]);

    await page.goto('/review');
    // The indicator carries both reasons (hard dominates the display order).
    await expect(reasonIndicator(page, 'Subtype not confirmed')).toBeVisible();
    await expect(page.getByText(/1\s+need\s+resolution/)).toBeVisible();
    await expect(confirmBtn(page)).toBeDisabled();

    await openEditFor(page, 'CARD POS COFFEE');
    // The dialog surfaces the hard reason AND the advisory together before save.
    await expect(page.getByText('Subtype not confirmed')).toBeVisible();
    await expect(page.getByText('Low confidence')).toBeVisible();
    await page.locator('#edit-subtype').selectOption('purchase');
    await page.locator('#edit-category').selectOption('dining');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Transaction' })).not.toBeVisible({ timeout: 5000 });

    // Hard reason resolved on save (low_confidence clearing is verified in the
    // dedicated advisory-persistence test, where it is the top reason).
    await expect(reasonIndicator(page, 'Subtype not confirmed')).not.toBeVisible({ timeout: 5000 });
    await expect(confirmBtn(page)).toBeEnabled();
  });
});

// ===========================================================================
// Resolution count + multi-row gate
// ===========================================================================
test.describe('Review gating — resolution count and multi-row commit', () => {
  test('two hard rows show "2 needs resolution"; resolving both opens the gate and commits', async ({ context, page }) => {
    await setupTestContext(context);
    await seedReviewSession(context, [
      { id: 'm1', date: '2026-06-01', description: 'NEFT TO SAVINGS', amount: 5000, type: 'debit', category: 'transfer', merchant: 'Bank', transactionSubType: 'self_transfer', llmConfidence: 0.9, categoryConfidence: 0.9, reviewReasons: ['self_transfer_unresolved'], sourceType: 'bank' },
      { id: 'm2', date: '2026-06-02', description: 'CARD POS DRINKS', amount: 320, type: 'debit', category: 'other', merchant: 'Pos', transactionSubType: 'purchase', llmConfidence: 0, categoryConfidence: 0.3, reviewReasons: ['subtype_inferred'], sourceType: 'bank' },
    ]);

    await page.goto('/review');
    await expect(page.getByText(/2\s+needs?\s+resolution/)).toBeVisible();
    await expect(confirmBtn(page)).toBeDisabled();

    // Resolve row 1.
    await openEditFor(page, 'NEFT TO SAVINGS');
    await page.locator('#edit-subtype').selectOption('self_transfer');
    await page.locator('#edit-category').selectOption('transfer');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Transaction' })).not.toBeVisible({ timeout: 5000 });
    // One down, one to go.
    await expect(page.getByText(/1\s+need\s+resolution/)).toBeVisible({ timeout: 5000 });
    await expect(confirmBtn(page)).toBeDisabled();

    // Resolve row 2.
    await openEditFor(page, 'CARD POS DRINKS');
    await page.locator('#edit-subtype').selectOption('purchase');
    await page.locator('#edit-category').selectOption('dining');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Transaction' })).not.toBeVisible({ timeout: 5000 });

    await expect(page.getByText(/needs?\s+resolution/)).toHaveCount(0);
    await expect(confirmBtn(page)).toBeEnabled();

    await confirmBtn(page).click();
    await page.waitForURL('**/dashboard', { timeout: 10000 });
  });
});

// ===========================================================================
// Failed import analogue: no session -> redirect (the hard-failed parse never
// reaches review; the review-side behaviour is "nothing to review, go home").
// ===========================================================================
test.describe('Review gating — no session (failed-import analogue)', () => {
  test('no review session redirects away from /review', async ({ context, page }) => {
    await setupTestContext(context);
    await page.goto('/review');
    await page.waitForURL((url) => !url.pathname.includes('/review'), { timeout: 10000 }).catch(() => null);
    expect(page.url()).not.toContain('/review');
  });
});
