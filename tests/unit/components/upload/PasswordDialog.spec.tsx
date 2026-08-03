import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PasswordDialog } from '@/components/upload/PasswordDialog';
import { PASSWORD_REASON } from '@/lib/parsers/documentExtraction';

const onSubmit = vi.fn();

function renderDialog(overrides: {
  open?: boolean;
  reason?: number;
  error?: string;
  isProcessing?: boolean;
} = {}) {
  return render(
    <PasswordDialog
      open={overrides.open ?? true}
      onOpenChange={() => {}}
      onSubmit={onSubmit}
      reason={overrides.reason}
      error={overrides.error}
      isProcessing={overrides.isProcessing}
    />,
  );
}

const passwordInput = () => screen.getByLabelText('Password') as HTMLInputElement;

describe('PasswordDialog', () => {
  beforeEach(() => {
    onSubmit.mockReset();
  });

  describe('open / closed', () => {
    it('renders nothing when closed', () => {
      renderDialog({ open: false });
      expect(screen.queryByText('Password Required')).toBeNull();
      expect(screen.queryByLabelText('Password')).toBeNull();
    });

    it('shows the first-run copy by default (NEED_PASSWORD)', () => {
      renderDialog({});
      expect(screen.getByText('Password Required')).toBeTruthy();
      expect(screen.getByText(/password protected/i)).toBeTruthy();
    });
  });

  describe('reason-driven copy', () => {
    it('switches to the incorrect-password copy on INCORRECT_PASSWORD', () => {
      renderDialog({ reason: PASSWORD_REASON.INCORRECT_PASSWORD });
      expect(screen.getByText('Incorrect Password')).toBeTruthy();
      expect(screen.getByText(/entered was incorrect/i)).toBeTruthy();
      // Negative: the first-run title must not also be present.
      expect(screen.queryByText('Password Required')).toBeNull();
    });

    it('shows the first-run copy on NEED_PASSWORD', () => {
      renderDialog({ reason: PASSWORD_REASON.NEED_PASSWORD });
      expect(screen.getByText('Password Required')).toBeTruthy();
      expect(screen.queryByText('Incorrect Password')).toBeNull();
    });
  });

  describe('submit', () => {
    it('submits the entered password', () => {
      renderDialog({});
      fireEvent.change(passwordInput(), { target: { value: 'secret123' } });
      fireEvent.click(screen.getByRole('button', { name: 'Unlock & Parse' }));
      expect(onSubmit).toHaveBeenCalledWith('secret123');
    });

    it('blocks submit when the password is only whitespace', () => {
      // The submit button is disabled for empty/whitespace, but a direct form submit
      // (e.g. browser autofill quirks) must still not fire onSubmit: handleSubmit
      // gates on password.trim().
      renderDialog({});
      // The form lives in Radix's portal (document.body), not the render root.
      const form = document.querySelector('form')!;
      fireEvent.change(passwordInput(), { target: { value: '    ' } });
      fireEvent.submit(form);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('Cancel invokes onSubmit with an empty string', () => {
      renderDialog({});
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onSubmit).toHaveBeenCalledWith('');
    });
  });

  describe('show / hide password', () => {
    it('toggles the input type and the accessible label', () => {
      renderDialog({});
      const input = passwordInput();
      expect(input.type).toBe('password');

      // Initially "Show password".
      fireEvent.click(screen.getByRole('button', { name: /show password/i }));
      expect(input.type).toBe('text');
      expect(screen.getByRole('button', { name: /hide password/i })).toBeTruthy();

      // Toggle back.
      fireEvent.click(screen.getByRole('button', { name: /hide password/i }));
      expect(input.type).toBe('password');
      expect(screen.getByRole('button', { name: /show password/i })).toBeTruthy();
    });
  });

  describe('processing state', () => {
    it('disables the input and both buttons and shows the spinner label', () => {
      renderDialog({ isProcessing: true });

      expect(passwordInput().disabled).toBe(true);
      // Submit button becomes "Unlocking..." and is disabled.
      const submit = screen.getByRole('button', { name: /Unlocking/i });
      expect(submit.hasAttribute('disabled')).toBe(true);
      // Cancel is also disabled.
      expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
    });
  });

  describe('error display', () => {
    it('renders the error message', () => {
      renderDialog({ error: 'That password did not work.' });
      expect(screen.getByText('That password did not work.')).toBeTruthy();
    });

    it('renders no error element when none is passed', () => {
      renderDialog({});
      // The error slot is conditional; nothing destructive should render.
      expect(screen.queryByText('That password did not work.')).toBeNull();
    });
  });

  describe('reason change while open resets the typed password', () => {
    it('remounts the form (key change) and clears the field on INCORRECT_PASSWORD', () => {
      // On a wrong password the dialog stays open but the reason flips to
      // INCORRECT_PASSWORD; the form remounts via key so the stale entry is wiped.
      const { rerender } = renderDialog({ reason: PASSWORD_REASON.NEED_PASSWORD });
      fireEvent.change(passwordInput(), { target: { value: 'wrong-old-entry' } });
      expect(passwordInput().value).toBe('wrong-old-entry');

      rerender(
        <PasswordDialog
          open
          onOpenChange={() => {}}
          onSubmit={onSubmit}
          reason={PASSWORD_REASON.INCORRECT_PASSWORD}
        />,
      );

      expect(passwordInput().value).toBe('');
    });
  });
});
