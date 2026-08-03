import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewTransactionRow } from '@/components/review/ReviewTransactionRow';
import { makeTransaction } from '@tests/unit/factories';
import { formatSubType } from '@/models/Transaction';
import { getCategoryById } from '@/lib/categorization/categories';
import { REVIEW_REASONS } from '@/lib/review/reviewReasons';
import type { ReviewReason } from '@/lib/review/reviewReasons';
import type { Currency, Transaction } from '@/types';
import '@/lib/categorization/categories';

const INR: Currency = { code: 'INR', symbol: '₹', name: 'Indian Rupee' };

// TableRow renders a <tr>; mount it inside a table so jsdom doesn't normalize it.
function renderRow(
  txn: Transaction,
  onEdit: (id: string) => void = vi.fn(),
  onDelete: (id: string) => void = vi.fn(),
) {
  return render(
    <table>
      <tbody>
        <ReviewTransactionRow
          transaction={txn}
          currency={INR}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </tbody>
    </table>,
  );
}

function rowTxn(overrides: {
  type?: 'debit' | 'credit';
  subType?: string;
  merchant?: string;
  description?: string;
  amount?: number;
  reviewReasons?: ReviewReason[];
}): Transaction {
  const t = makeTransaction({
    id: 't1',
    description: overrides.description ?? 'Coffee Shop',
    amount: overrides.amount ?? 250,
    type: overrides.type ?? 'debit',
    transactionSubType: overrides.subType ?? 'purchase',
    merchant: overrides.merchant ?? 'STARBUCKS',
  });
  return t.cloneWith({ reviewReasons: overrides.reviewReasons ?? [] });
}

const SHOPPING_NAME = getCategoryById('shopping')?.name ?? 'Shopping';
const PURCHASE_LABEL = formatSubType('purchase');

describe('ReviewTransactionRow', () => {
  describe('clean row (no review reasons)', () => {
    it('renders subtype text + category badge and no alert marker', () => {
      renderRow(rowTxn({}));

      // Subtype cell shows the formatted subtype; category cell shows the badge.
      expect(screen.getByText(PURCHASE_LABEL)).toBeTruthy();
      expect(screen.getByText(SHOPPING_NAME)).toBeTruthy();
      // No issue marker.
      expect(screen.queryByRole('img', { name: /^Review issues/ })).toBeNull();
      // No merged "select" affordance.
      expect(screen.queryByRole('button', { name: 'Select Subtype / Category' })).toBeNull();
    });

    it('falls back to description as the title when there is no merchant', () => {
      renderRow(rowTxn({ merchant: undefined, description: 'NEFT to Self' }));
      // merchant || description → description is the primary line.
      expect(screen.getByText('NEFT to Self')).toBeTruthy();
    });
  });

  describe('credit vs debit', () => {
    it('labels a credit with a Credit badge and emerald amount', () => {
      const { container } = renderRow(rowTxn({ type: 'credit' }));
      expect(screen.getByText('Credit').className).toContain('emerald');
      // The amount color span is font-mono font-semibold; credit → emerald.
      const amountSpan = container.querySelector('.font-mono.font-semibold')!;
      expect(amountSpan.className).toContain('emerald');
    });

    it('labels a debit with a Debit badge and rose amount', () => {
      const { container } = renderRow(rowTxn({ type: 'debit' }));
      expect(screen.getByText('Debit').className).toContain('slate');
      // Negative case: a debit amount must carry rose, never the credit emerald.
      const amountSpan = container.querySelector('.font-mono.font-semibold')!;
      expect(amountSpan.className).toContain('rose');
      expect(amountSpan.className).not.toContain('emerald');
    });
  });

  describe('review-reason severity', () => {
    it('shows an amber alert for an advisory-only reason and keeps the cells intact', () => {
      renderRow(rowTxn({ reviewReasons: ['low_confidence'] }));

      const marker = screen.getByRole('img', { name: /^Review issues/ });
      // Advisory → amber icon, not red.
      expect(marker.className).toContain('amber-500');
      expect(marker.className).not.toContain('red-500');
      // Advisory reason is not in the subtype/category set → cells stay split.
      expect(screen.getByText(PURCHASE_LABEL)).toBeTruthy();
      expect(screen.getByText(SHOPPING_NAME)).toBeTruthy();
    });

    it('shows a red alert + merged "Select" button for a subtype/category hard reason', () => {
      renderRow(rowTxn({ reviewReasons: ['subtype_inferred'] }));

      const marker = screen.getByRole('img', { name: /^Review issues/ });
      expect(marker.className).toContain('red-500');
      // Cells collapsed into the single CTA; subtype text and category badge are gone.
      expect(screen.getByRole('button', { name: 'Select Subtype / Category' })).toBeTruthy();
      expect(screen.queryByText(PURCHASE_LABEL)).toBeNull();
      expect(screen.queryByText(SHOPPING_NAME)).toBeNull();
    });

    it('keeps cells split for a hard reason that is NOT about subtype/category', () => {
      // missing_or_invalid_field is hard (red icon) but not in the blank-cell set, so
      // the subtype text + category badge must still render. This is the negative case
      // that stops "hard" and "blank the cells" from being conflated.
      renderRow(rowTxn({ reviewReasons: ['missing_or_invalid_field'] }));

      const marker = screen.getByRole('img', { name: /^Review issues/ });
      expect(marker.className).toContain('red-500');
      expect(screen.queryByRole('button', { name: 'Select Subtype / Category' })).toBeNull();
      expect(screen.getByText(PURCHASE_LABEL)).toBeTruthy();
      expect(screen.getByText(SHOPPING_NAME)).toBeTruthy();
    });

    it('lists every reason label in the marker aria-label, joined by "; "', () => {
      const reasons: ReviewReason[] = ['subtype_inferred', 'low_confidence'];
      renderRow(rowTxn({ reviewReasons: reasons }));

      const marker = screen.getByRole('img', { name: /^Review issues/ });
      const joined = reasons.map((r) => REVIEW_REASONS[r].label).join('; ');
      expect(marker.getAttribute('aria-label')).toBe(`Review issues — ${joined}`);
    });
  });

  describe('action callbacks', () => {
    it('the merged "Select" button invokes onEdit with the row id', () => {
      const onEdit = vi.fn();
      renderRow(rowTxn({ reviewReasons: ['subtype_inferred'] }), onEdit);

      fireEvent.click(screen.getByRole('button', { name: 'Select Subtype / Category' }));
      expect(onEdit).toHaveBeenCalledWith('t1');
    });

    it('the edit and delete icon buttons invoke their callbacks', () => {
      const onEdit = vi.fn();
      const onDelete = vi.fn();
      const { container } = renderRow(rowTxn({}), onEdit, onDelete);

      // The actions cell is last; its buttons are [edit-icon, delete-icon] in order.
      const cells = container.querySelectorAll('td');
      const actionButtons = cells[cells.length - 1].querySelectorAll('button');

      fireEvent.click(actionButtons[0]);
      expect(onEdit).toHaveBeenCalledWith('t1');

      fireEvent.click(actionButtons[1]);
      expect(onDelete).toHaveBeenCalledWith('t1');
    });
  });

  describe('confidence readout in the tooltip', () => {
    it('renders verification + category confidence as rounded percentages', async () => {
      // The readout lives inside a Radix (portal) tooltip, which renders its content only
      // when open — so open it via hover before querying. 0-1 fields must render as 88% /
      // 60%, not 0.88% or 8800%.
      const user = userEvent.setup();
      const txn = rowTxn({ reviewReasons: ['low_confidence'] }).cloneWith({
        verificationConfidence: 0.88,
        categoryConfidence: 0.6,
      });
      renderRow(txn);

      await user.hover(screen.getByRole('img', { name: /Review issues/ }));
      expect(await screen.findByText(/Verification 88%/)).toBeTruthy();
      expect(screen.getByText(/Category 60%/)).toBeTruthy();
    });

    it('drops a NaN confidence instead of rendering "NaN%"', async () => {
      // isFinite(NaN) is false → confidencePct returns null. A real engine could stamp
      // NaN; the row must not surface garbage text.
      const user = userEvent.setup();
      const txn = rowTxn({ reviewReasons: ['low_confidence'] }).cloneWith({
        verificationConfidence: NaN,
        categoryConfidence: 0.6,
      });
      renderRow(txn);

      await user.hover(screen.getByRole('img', { name: /Review issues/ }));
      await screen.findByText(/Category 60%/); // confirms the tooltip is open
      expect(screen.queryByText(/Verification/)).toBeNull();
    });
  });

  describe('row border tiers — unified verification-confidence grading (clean rows only; hard reasons take the amber background)', () => {
    it('marks a clean really-low-verification row (<50%) with the red-dashed border', () => {
      const txn = rowTxn({ reviewReasons: [] }).cloneWith({ verificationConfidence: 0.3 });
      const { container } = renderRow(txn);
      const row = container.querySelector('tr')!;
      expect(row.className).toContain('border-red-400');
      expect(row.className).toContain('border-dashed');
    });

    it('marks a clean low-verification row (50–85%) with the amber-dashed border', () => {
      const txn = rowTxn({ reviewReasons: [] }).cloneWith({ verificationConfidence: 0.6 });
      const { container } = renderRow(txn);
      const row = container.querySelector('tr')!;
      expect(row.className).toContain('border-amber-400');
      expect(row.className).toContain('border-dashed');
    });

    it('marks a clean high-verification row (>=85%) with no warning border', () => {
      const txn = rowTxn({ reviewReasons: [] }).cloneWith({ verificationConfidence: 0.9 });
      const { container } = renderRow(txn);
      const row = container.querySelector('tr')!;
      expect(row.className).not.toContain('border-red-400');
      expect(row.className).not.toContain('border-amber-400');
    });
  });
});
