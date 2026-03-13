"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileUpload } from "./FileUpload";
import { PasswordDialog } from "./PasswordDialog";
import { parseCSV } from "@/lib/parsers/csvParser";
import { parseXLS } from "@/lib/parsers/xlsParser";
import {
  checkLLMStatus,
  parseWithLLMExtended,
  isPasswordError,
} from "@/lib/parsers/llmParser";
import { normalizeMerchantName, categorizeTransaction } from "@/lib/categorizer";
import { DEFAULT_CATEGORIES } from "@/lib/categorization/categories";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { useChatStore } from "@/lib/store/chatStore";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { LLMStatus, ParsedStatement, Currency, Transaction, Category } from "@/types";
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

const MAX_PASSWORD_ATTEMPTS = 3;

interface FileProcessorProps {
  onSuccess?: () => void;
  onProcessingChange?: (isProcessing: boolean) => void;
}

export function FileProcessor({ onSuccess, onProcessingChange }: FileProcessorProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const processingStartTime = useRef<number>(0);
  
  // Notify parent when processing state changes
  useEffect(() => {
    if (isProcessing) {
      processingStartTime.current = Date.now();
    } else {
      // Log processing time when done
      if (processingStartTime.current > 0) {
        const elapsed = ((Date.now() - processingStartTime.current) / 1000).toFixed(2);
        console.log(`[FileProcessor] Processing completed in ${elapsed}s`);
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
  const addCCStatement = useCreditCardStore((state) => state.addStatement);
  const router = useRouter();

  // Check LLM status on mount
  useEffect(() => {
    checkLLMStatus().then(setLlmStatus);
  }, []);

  // Common processing logic for parsed statements
  const processParsedStatement = useCallback((
    parsed: ParsedStatement,
    detectedCurrency: Currency | null,
  ) => {
    if (parsed.transactions.length === 0) {
      throw new Error(
        "No transactions found. Check if the file format is supported or try enabling AI parsing in Settings.",
      );
    }

    // Warn about failed chunks
    if (parsed.failedChunks && parsed.failedChunks.length > 0) {
      toast.warning(`${parsed.failedChunks.length} sections could not be parsed`, {
        description: "Some transactions are missing from your statement. " +
          "Try re-uploading with a different AI model, or check the browser console for details.",
        duration: 10000,
      });
      console.warn(
        `[Parser] ${parsed.failedChunks.length} chunks failed to parse. Transactions from these sections are missing:`,
        parsed.failedChunks
      );
    }

    // Auto-set detected currency
    if (detectedCurrency) {
      setCurrency(detectedCurrency);
    }

    // Categorize transactions using keyword matching
    const categorized = parsed.transactions.map((txn) => {
      const category = categorizeTransaction(txn.description, txn.amount, DEFAULT_CATEGORIES);
      return new Transaction(
        txn.id,
        txn.date,
        txn.description,
        txn.amount,
        txn.type,
        Category.fromId(category) ?? Category.fromId(Category.DEFAULT_ID)!,
        txn.balance,
        normalizeMerchantName(txn.description), // merchant
        txn.originalText,
        txn.budgetMonth,
        txn.categoryConfidence,
        txn.needsReview,
        txn.categorizedBy,
        txn.sourceType,
        txn.statementId,
        txn.cardIssuer,
        txn.cardLastFour,
        txn.cardHolder,
        txn.localCurrency,
        txn.originalCurrency,
        txn.originalAmount,
        txn.isInternational,
        txn.isAnomaly,
        txn.anomalyTypes,
        txn.anomalyDetails,
        txn.anomalyDismissed,
      );
    });

    // Store for review page
    sessionStorage.setItem(
      "pendingTransactions",
      JSON.stringify(categorized),
    );

    // Store the model used for chat
    const activeModel = llmModel || llmStatus?.selectedModel;
    if (activeModel) {
      setModel(activeModel);
    }

    const currencyInfo = detectedCurrency
      ? ` (${detectedCurrency.code})`
      : "";
    const successMessage = `Parsed ${categorized.length} transactions${currencyInfo}! Redirecting to review…`;
    setSuccess(successMessage);

    // Show processing time toast
    if (processingStartTime.current > 0) {
      const elapsed = ((Date.now() - processingStartTime.current) / 1000).toFixed(2);
      toast.success('Statement processed successfully', {
        description: `Completed in ${elapsed} seconds`,
        duration: 5000,
      });
      console.log(`[FileProcessor] Processing completed in ${elapsed}s`);
      processingStartTime.current = 0;
    }

    // Close password dialog if open
    setPasswordDialogOpen(false);

    // Close dialog before redirect to prevent unmount issues
    onSuccess?.();

    setTimeout(() => router.push("/review"), 1000);
  }, [setCurrency, llmModel, llmStatus?.selectedModel, setModel, onSuccess, router]);

  // Process file after statement type is selected
  const processFileWithStatementType = useCallback(async (
    file: File,
    selectedType: 'auto' | 'bank' | 'credit_card',
    password?: string
  ) => {
    const ext = file.name.toLowerCase();
    const isCSV = ext.endsWith(".csv");
    const isXLS = ext.endsWith(".xls") || ext.endsWith(".xlsx");

    let parsed: ParsedStatement;
    let detectedCurrency: Currency | null = null;

    if (ext.endsWith(".pdf")) {
      // Pass statement type to parser (undefined = auto-detect)
      const statementTypeParam = selectedType === 'auto' ? undefined : selectedType;
      try {
        const result = await parseWithLLMExtended(file, setProgress, password, statementTypeParam);
        parsed = result.statement;
        detectedCurrency = result.currency;
        // Store CC statement metadata for the credit cards page
        if (result.ccStatement) {
          addCCStatement(result.ccStatement);
        }
        processParsedStatement(parsed, detectedCurrency);
      } catch (err) {
        if (isPasswordError(err)) {
          // PDF needs password - show password dialog
          setPendingFile(file);
          setPasswordDialogOpen(true);
          // Also save the statement type selection for retry
          setPendingTypeFile(file);
          setPendingTypePassword(password);
          setStatementType(selectedType);
        } else {
          // Other error
          throw err;
        }
      }
    } else if (isCSV) {
      setProgress("Parsing CSV...");
      const result = await parseCSV(file);
      parsed = result.statement;
      detectedCurrency = result.detectedCurrency;
      processParsedStatement(parsed, detectedCurrency);
    } else if (isXLS) {
      setProgress("Parsing Excel file...");
      const result = await parseXLS(file);
      parsed = result.statement;
      detectedCurrency = result.detectedCurrency;
      processParsedStatement(parsed, detectedCurrency);
    } else {
      throw new Error(
        "Unsupported file format. Please upload a PDF, CSV, XLS, or XLSX file.",
      );
    }
  }, [processParsedStatement, addCCStatement]);

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
    if (!pendingFile) return;

    setPasswordDialogOpen(false);
    setIsProcessing(true);
    setProgress("Parsing PDF with password...");

    try {
      // Use the saved statement type from the type dialog (or 'auto' if coming from old flow)
      const typeToUse = pendingTypeFile ? statementType : 'auto';
      await processFileWithStatementType(pendingFile, typeToUse, password);
      // Success - clear password state
      setPendingFile(null);
      setPasswordAttempts(0);
      setPendingTypeFile(null);
      setPendingTypePassword(undefined);
      setStatementType('auto');
    } catch (err) {
      if (isPasswordError(err)) {
        const newAttempts = passwordAttempts + 1;
        setPasswordAttempts(newAttempts);

        if (newAttempts >= MAX_PASSWORD_ATTEMPTS) {
          // Too many failed attempts
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
        // Other error
        setPendingFile(null);
        setPasswordAttempts(0);
        setPendingTypeFile(null);
        setPendingTypePassword(undefined);
        setError(err instanceof Error ? err.message : "Failed to parse PDF file");
      }
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  }, [pendingFile, passwordAttempts, processFileWithStatementType, pendingTypeFile, statementType]);

  // Handle password dialog cancel
  const handlePasswordCancel = useCallback(() => {
    setPasswordDialogOpen(false);
    setPendingFile(null);
    setPasswordAttempts(0);
    setPasswordError(null);
    setIsProcessing(false);
    setProgress(null);
    setPendingTypeFile(null);
    setPendingTypePassword(undefined);
  }, []);

  // Handle statement type dialog continue
  const handleStatementTypeContinue = useCallback(() => {
    setStatementTypeDialogOpen(false);
    if (pendingTypeFile) {
      setIsProcessing(true);
      processFileWithStatementType(pendingTypeFile, statementType, pendingTypePassword);
      setPendingTypeFile(null);
      setPendingTypePassword(undefined);
    }
  }, [pendingTypeFile, statementType, pendingTypePassword, processFileWithStatementType]);

  // Handle statement type dialog cancel
  const handleStatementTypeCancel = useCallback(() => {
    setStatementTypeDialogOpen(false);
    setPendingTypeFile(null);
    setPendingTypePassword(undefined);
    setIsProcessing(false);
    setProgress(null);
  }, []);

  const handleFileSelect = async (file: File) => {
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
          console.log(`[FileProcessor] Processing failed after ${elapsed}s: ${errorMessage}`);
          processingStartTime.current = 0;
        }
      }
    } finally {
      // Only clear processing if not waiting for password
      if (!passwordDialogOpen) {
        setIsProcessing(false);
        setProgress(null);
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

