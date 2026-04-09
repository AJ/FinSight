"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileUpload } from "./FileUpload";
import { PasswordDialog } from "./PasswordDialog";
import { isPasswordError } from "@/lib/parsers/llmParser";
import { runPreReviewPipeline } from "@/lib/pipelines/preReviewPipeline";
import { AbortManager } from '@/lib/utils/AbortManager';
import { subscribeToLLMConnection } from '@/lib/store/llmConnectionStore';
import { useSettingsStore } from "@/lib/store/settingsStore";
import { useChatStore } from "@/lib/store/chatStore";
import { LLMStatus } from "@/types";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { debugLog, debugWarn } from "@/lib/utils/debug";

const MAX_PASSWORD_ATTEMPTS = 3;

interface FileProcessorProps {
  onSuccess?: () => void;
  onProcessingChange?: (isProcessing: boolean) => void;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const err = error as Record<string, unknown>;
  const message = typeof err.message === "string" ? err.message.toLowerCase() : "";

  return (
    err.name === "AbortError" ||
    message.includes("cancelled") ||
    message.includes("canceled")
  );
}

export function FileProcessor({ onSuccess, onProcessingChange }: FileProcessorProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const processingStartTime = useRef<number>(0);
  const abortManager = useRef<AbortManager>(new AbortManager());
  const isMountedRef = useRef(true);
  const wasCancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      wasCancelledRef.current = true;
      abortManager.current.abortAll('Component unmounted');
    };
  }, []);

  // Notify parent when processing state changes
  useEffect(() => {
    if (isProcessing) {
      processingStartTime.current = Date.now();
    } else {
      // Log processing time when done
      if (processingStartTime.current > 0) {
        const elapsed = ((Date.now() - processingStartTime.current) / 1000).toFixed(2);
        debugLog(`[FileProcessor] Processing completed in ${elapsed}s`);
        processingStartTime.current = 0;
      }
    }
    onProcessingChange?.(isProcessing);
  }, [isProcessing, onProcessingChange]);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [llmStatus, setLlmStatus] = useState<LLMStatus | null>(null);

  // Password dialog state
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordAttempts, setPasswordAttempts] = useState(0);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  // Statement type selector state
  const [statementTypeDialogOpen, setStatementTypeDialogOpen] = useState(false);
  const [statementType, setStatementType] = useState<'auto' | 'bank' | 'credit_card'>('auto');
  const [pendingTypeFile, setPendingTypeFile] = useState<File | null>(null);
  const [pendingTypePassword, setPendingTypePassword] = useState<string | undefined>();

  const setCurrency = useSettingsStore((state) => state.setCurrency);
  const llmModel = useSettingsStore((state) => state.llmModel);
  const setModel = useChatStore((state) => state.setModel);
  const router = useRouter();

  // Subscribe to LLM connection status (uses centralized cache)
  useEffect(() => {
    return subscribeToLLMConnection((status) => {
      setLlmStatus(status);
    });
  }, []);

  // Common processing logic for staged review sessions
  const processReviewSession = useCallback((
    transactionCount: number,
    detectedCurrencyCode?: string,
    failedChunks?: string[],
  ) => {
    if (wasCancelledRef.current) {
      return;
    }

    if (transactionCount === 0) {
      throw new Error(
        "No transactions found. Check if the file format is supported or try enabling AI parsing in Settings.",
      );
    }

    // Warn about failed chunks
    if (failedChunks && failedChunks.length > 0) {
      toast.warning(`${failedChunks.length} sections could not be parsed`, {
        description: "Some transactions are missing from your statement. " +
          "Try re-uploading with a different AI model, or check the browser console for details.",
        duration: 10000,
      });
      debugWarn(
        'parser',
        `${failedChunks.length} chunks failed to parse. Transactions from these sections are missing:`,
        failedChunks
      );
    }

    // Store the model used for chat
    const activeModel = llmModel || llmStatus?.selectedModel;
    if (activeModel) {
      setModel(activeModel);
    }

    const currencyInfo = detectedCurrencyCode
      ? ` (${detectedCurrencyCode})`
      : "";
    const successMessage = `Parsed ${transactionCount} transactions${currencyInfo}! Redirecting to review…`;
    setSuccess(successMessage);

    // Show processing time toast
    if (processingStartTime.current > 0) {
      const elapsed = ((Date.now() - processingStartTime.current) / 1000).toFixed(2);
      toast.success('Statement processed successfully', {
        description: `Completed in ${elapsed} seconds`,
        duration: 5000,
      });
      debugLog(`[FileProcessor] Processing completed in ${elapsed}s`);
      processingStartTime.current = 0;
    }

    // Close password dialog if open
    setPasswordDialogOpen(false);

    // Close dialog before redirect to prevent unmount issues
    onSuccess?.();

    setTimeout(() => router.push("/review"), 1000);
  }, [llmModel, llmStatus?.selectedModel, setModel, onSuccess, router]);

  // Process file after statement type is selected
  const processFileWithStatementType = useCallback(async (
    file: File,
    selectedType: 'auto' | 'bank' | 'credit_card',
    password?: string
  ) => {
    const abortController = new AbortController();
    abortManager.current = new AbortManager();
    abortManager.current.signal(); // Register the signal
    wasCancelledRef.current = false;

    try {
      const settings = useSettingsStore.getState();
      const reviewSession = await runPreReviewPipeline({
        file,
        provider: settings.llmProvider,
        baseUrl: settings.llmServerUrl,
        model: settings.llmModel || undefined,
        defaultCurrency: settings.currency,
        password,
        statementType: selectedType === 'auto' ? undefined : selectedType,
        onProgress: setProgress,
        signal: abortController.signal,
      });

      if (wasCancelledRef.current || abortController.signal.aborted) {
        return;
      }

      setCurrency(reviewSession.currency);
      processReviewSession(
        reviewSession.transactions.length,
        reviewSession.currency.code,
        reviewSession.sourceMetadata?.failedChunks,
      );
    } catch (err) {
      if (abortController.signal.aborted || wasCancelledRef.current || isAbortError(err)) {
        return;
      }

      if (isPasswordError(err)) {
        setPendingFile(file);
        setPasswordDialogOpen(true);
        setPendingTypeFile(file);
        setPendingTypePassword(password);
        setStatementType(selectedType);
        throw err;
      }

      debugLog('[FileProcessor][PreReviewPipeline] Error:', err);
      throw err;
    }

    if (abortController.signal.aborted) {
      return;
    }
    abortManager.current.abortAll();
  }, [processReviewSession, setCurrency]);

  // Process a file with optional password (for PDFs)
  const processFile = useCallback(async (file: File, password?: string) => {
    const ext = file.name.toLowerCase();
    const isPDF = ext.endsWith(".pdf");

    // Show statement type selector for PDF files
    if (isPDF) {
      setPendingTypeFile(file);
      setPendingTypePassword(password);
      setStatementType('auto');  // Reset to auto-detect default
      setStatementTypeDialogOpen(true);
      return;  // Wait for user selection
    }

    // For CSV/XLS, proceed with parsing (no type selector needed yet)
    await processFileWithStatementType(file, 'auto', password);
  }, [processFileWithStatementType]);

  // Handle password submission - retry with password
  const handlePasswordSubmit = useCallback(async (password: string) => {
    debugLog('[fileprocesser][PasswordSubmit] pendingFile:', pendingFile, 'password:', password ? '***' : 'empty');
    if (!pendingFile) return;

    setPasswordDialogOpen(false);
    setIsProcessing(true);
    setProgress("Parsing PDF with password...");

    try {
      // Use the saved statement type from the type dialog (or 'auto' if coming from old flow)
      const typeToUse = pendingTypeFile ? statementType : 'auto';
      await processFileWithStatementType(pendingFile, typeToUse, password);
      // Success - clear password state
      debugLog('[FileProcessor][PasswordSubmit] Password correct, file processed successfully. Clearing password state and setpendingfile to null');
      setPendingFile(null);
      setPasswordAttempts(0);
      setPendingTypeFile(null);
      setPendingTypePassword(undefined);
      setStatementType('auto');
    } catch (err) {
      // debugError('[FileProcessor][PasswordSubmit] Error:', err, 'isPasswordError:', isPasswordError(err));
      if (isPasswordError(err)) {
        const newAttempts = passwordAttempts + 1;
        setPasswordAttempts(newAttempts);
        debugLog(`[FileProcessor][PasswordSubmit] Password attempt ${newAttempts} failed for file:`, pendingFile.name, 'max attempts:', MAX_PASSWORD_ATTEMPTS);
        if (newAttempts >= MAX_PASSWORD_ATTEMPTS) {
          debugLog(`[FileProcessor][PasswordSubmit] Max password attempts reached for file:`, pendingFile.name, ' newAttempts:', newAttempts);
          // Too many failed attempts
          debugLog('[FileProcessor][PasswordSubmit] Password correct, file processed successfully. Clearing password state and setpendingfile to null. Attempt counts', newAttempts);
          setPendingFile(null);
          setPasswordAttempts(0);
          setPendingTypeFile(null);
          setPendingTypePassword(undefined);
          setError("Too many failed password attempts. Please try uploading again.");
        } else {
          // Show error and re-open dialog for retry
          const remaining = MAX_PASSWORD_ATTEMPTS - newAttempts;
          setPasswordError(`Incorrect password. ${remaining} attempt${remaining > 1 ? "s" : ""} remaining.`);
          setPasswordDialogOpen(true);
        }
      } else {
        debugLog('[FileProcessor][PasswordSubmit] "other" error:', err);
        // Other error
        debugLog('[FileProcessor][PasswordSubmit] Non-password error occurred. Clearing pending file and password state. Error:', err, 'pendingFile:', pendingFile.name, 'passwordAttempts:', passwordAttempts);
        setPendingFile(null);
        setPasswordAttempts(0);
        setPendingTypeFile(null);
        setPendingTypePassword(undefined);
        setError(err instanceof Error ? err.message : "Failed to parse PDF file");
      }
    } finally {
      debugLog('[FileProcessor][PasswordSubmit] Finally block reached. Clearing processing state if not waiting for password. pendingFile:', pendingFile, 'passwordDialogOpen:', passwordDialogOpen);
      setIsProcessing(false);
      setProgress(null);
    }
  }, [pendingFile, passwordAttempts, processFileWithStatementType, pendingTypeFile, statementType, passwordDialogOpen]);

  // Handle password dialog cancel
  const handlePasswordCancel = useCallback(() => {
    setPasswordDialogOpen(false);
    debugLog('[FileProcessor][PasswordCancel] Password dialog cancelled. Clearing pending file and password state. pendingFile:', pendingFile ? pendingFile.name : 'null');
    setPendingFile(null);
    setPasswordAttempts(0);
    setPasswordError(null);
    setIsProcessing(false);
    setProgress(null);
    setPendingTypeFile(null);
    setPendingTypePassword(undefined);
  }, [pendingFile]);

  // Handle statement type dialog continue
  // ========== FIX (2026-03-16) START ==========
  // Changed to async/await with try-catch to handle password errors.
  // Password errors are handled inside processFileWithStatementType (shows dialog),
  // so we swallow those errors here. Non-password errors are re-thrown.
  const handleStatementTypeContinue = useCallback(async () => {
    setStatementTypeDialogOpen(false);
    if (pendingTypeFile) {
      setIsProcessing(true);
      try {
        await processFileWithStatementType(pendingTypeFile, statementType, pendingTypePassword);
        setPendingTypeFile(null);
        setPendingTypePassword(undefined);
      } catch (err) {
        // Password errors are handled inside processFileWithStatementType (shows dialog)
        // Just swallow the error here - don't let it bubble up
        if (!isPasswordError(err)) {
          // Non-password errors should still be shown
          throw err;
        }
      }
    }
  }, [pendingTypeFile, statementType, pendingTypePassword, processFileWithStatementType]);
  // ========== FIX (2026-03-16) END ==========
  // Old code (sync, no error handling):
  /*
  const handleStatementTypeContinue = useCallback(() => {
    setStatementTypeDialogOpen(false);
    if (pendingTypeFile) {
      setIsProcessing(true);
      processFileWithStatementType(pendingTypeFile, statementType, pendingTypePassword);
      setPendingTypeFile(null);
      setPendingTypePassword(undefined);
    }
  }, [pendingTypeFile, statementType, pendingTypePassword, processFileWithStatementType]);
  */

  // Handle statement type dialog cancel
  const handleStatementTypeCancel = useCallback(() => {
    setStatementTypeDialogOpen(false);
    setPendingTypeFile(null);
    setPendingTypePassword(undefined);
    setIsProcessing(false);
    setProgress(null);
  }, []);

  const handleFileSelect = async (file: File) => {
    wasCancelledRef.current = false;
    setIsProcessing(true);
    setError(null);
    setSuccess(null);
    setProgress(null);
    setPasswordAttempts(0);
    setPasswordError(null);

    try {
      // First attempt - no password
      await processFile(file);
    } catch (err) {
      if (wasCancelledRef.current || isAbortError(err)) {
        return;
      }
      if (isPasswordError(err)) {
        // PDF needs password - show dialog
        setPendingFile(file);
        setPasswordDialogOpen(true);
        setIsProcessing(false);
        setProgress(null);
      } else {
        const errorMessage = err instanceof Error ? err.message : "Failed to process file";
        setError(errorMessage);
        
        // Log processing time even on error
        if (processingStartTime.current > 0) {
          const elapsed = ((Date.now() - processingStartTime.current) / 1000).toFixed(2);
          debugLog(`[FileProcessor] Processing failed after ${elapsed}s: ${errorMessage}`);
          processingStartTime.current = 0;
        }
      }
    } finally {
      // Only clear processing if not waiting for password
      if (!passwordDialogOpen) {
        // debugError('[FileProcessor][handleFileSelect] Finally block reached. Clearing processing state. passwordDialogOpen:', passwordDialogOpen);
        if (isMountedRef.current) {
          setIsProcessing(false);
          setProgress(null);
        }
      }
    }
  };

  return (
    <div className="space-y-4">
      <AnimatePresence mode="wait">
        {/* Show upload form OR processing indicator, not both */}
        {isProcessing ? (
          <motion.div
            key="processing"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <Card className="bg-muted/50 border-primary/20">
              <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <div className="text-center">
                  <p className="text-lg font-semibold">
                    {progress || 'Processing your statement...'}
                  </p>
                  {!progress && (
                    <p className="text-sm text-muted-foreground">
                      This may take a few moments depending on file size
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <motion.div
            key="upload"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <FileUpload onFileSelect={handleFileSelect} isProcessing={false} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Password Dialog */}
      <PasswordDialog
        open={passwordDialogOpen}
        onOpenChange={(open) => {
          debugLog('[FileProcessor][PasswordDialog] onOpenChange called with open:', open);
          if (!open) {
            handlePasswordCancel();
          }
        }}
        onSubmit={handlePasswordSubmit}
        error={passwordError || undefined}
        isProcessing={false}
        reason={passwordAttempts > 0 ? 2 : 1}
      />

      {error && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <p className="font-semibold">Error: {error}</p>
              {!llmStatus?.connected && (
                <p className="text-xs">
                  <strong>Tip:</strong> Go to Settings → AI Connection to
                  configure Ollama and select a model for best results.
                </p>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="border-success bg-success/20">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <AlertDescription className="text-success font-medium">
            {success}
          </AlertDescription>
        </Alert>
      )}

      {/* Statement Type Selector Dialog */}
      <Dialog
        open={statementTypeDialogOpen}
        onOpenChange={(open) => {
          // Prevent closing while processing
          if (!open && isProcessing) return;
          setStatementTypeDialogOpen(open);
        }}
      >
        <DialogContent
          onEscapeKeyDown={(e) => {
            // Prevent escape key while processing
            if (isProcessing) {
              e.preventDefault();
              return;
            }
            handleStatementTypeCancel();
          }}
        >
          <DialogHeader>
            <DialogTitle>Statement Type</DialogTitle>
            <DialogDescription>
              How should we detect the statement type?
            </DialogDescription>
          </DialogHeader>
          <RadioGroup 
            value={statementType} 
            onValueChange={(v) => setStatementType(v as 'auto' | 'bank' | 'credit_card')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleStatementTypeContinue();
              }
            }}
          >
            <div className="flex items-start space-x-2">
              <RadioGroupItem value="auto" id="auto-detect" />
              <Label htmlFor="auto-detect" className="flex-1">
                <div className="font-medium">Auto-detect</div>
                <div className="text-sm text-muted-foreground">
                  Uses AI to identify statement type (takes 5-10 seconds)
                </div>
              </Label>
            </div>
            <div className="flex items-start space-x-2">
              <RadioGroupItem value="bank" id="bank-statement" />
              <Label htmlFor="bank-statement" className="flex-1">
                <div className="font-medium">Bank Statement</div>
                <div className="text-sm text-muted-foreground">
                  Savings or Current account statement
                </div>
              </Label>
            </div>
            <div className="flex items-start space-x-2">
              <RadioGroupItem value="credit_card" id="cc-statement" />
              <Label htmlFor="cc-statement" className="flex-1">
                <div className="font-medium">Credit Card Statement</div>
                <div className="text-sm text-muted-foreground">
                  Credit card billing statement
                </div>
              </Label>
            </div>
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={handleStatementTypeCancel}>
              Cancel
            </Button>
            <Button onClick={handleStatementTypeContinue}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
