"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Eye, EyeOff, AlertCircle, Loader2 } from "lucide-react";
import { PASSWORD_REASON } from "@/lib/parsers/llmParser";

interface PasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (password: string) => void;
  error?: string;
  isProcessing?: boolean;
  /** Password reason code: 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD */
  reason?: number;
}

function PasswordForm({
  onSubmit,
  error,
  isProcessing,
}: {
  onSubmit: (password: string) => void;
  error?: string;
  isProcessing: boolean;
}) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.trim()) {
      onSubmit(password);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="mt-4 space-y-3">
        <div className="space-y-1">
          <label htmlFor="pdf-password" className="text-sm font-medium">
            Password
          </label>
          <div className="relative">
            <Input
              id="pdf-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter PDF password"
              className="pr-10"
              autoFocus
              autoComplete="off"
              disabled={isProcessing}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
              <span className="sr-only">
                {showPassword ? "Hide password" : "Show password"}
              </span>
            </Button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <DialogFooter className="mt-6">
        <Button
          type="button"
          variant="outline"
          onClick={() => onSubmit("")}
          disabled={isProcessing}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!password.trim() || isProcessing}
        >
          {isProcessing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Unlocking...
            </>
          ) : (
            "Unlock & Parse"
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function PasswordDialog({
  open,
  onOpenChange,
  onSubmit,
  error,
  isProcessing = false,
  reason = PASSWORD_REASON.NEED_PASSWORD,
}: PasswordDialogProps) {
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      onOpenChange(false);
    }
  };

  // Dynamic content based on reason
  const isRetry = reason === PASSWORD_REASON.INCORRECT_PASSWORD;
  const title = isRetry ? "Incorrect Password" : "Password Required";
  const description = isRetry
    ? "The password you entered was incorrect. Please try again."
    : "This PDF file is password protected. Enter the password to unlock and parse it.";

  // Key changes when open or reason changes, remounting the form and resetting state
  const formKey = `${open}-${reason}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {open && (
          <PasswordForm
            key={formKey}
            onSubmit={onSubmit}
            error={error}
            isProcessing={isProcessing}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
