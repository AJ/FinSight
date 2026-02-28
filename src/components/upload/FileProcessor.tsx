"use client";

import { useState, useEffect, useCallback } from "react";
import { FileUpload } from "./FileUpload";
import { PasswordDialog } from "./PasswordDialog";
import { parseCSV } from "@/lib/parsers/csvParser";
import { parseXLS } from "@/lib/parsers/xlsParser";
import {
  checkLLMStatus,
  buildChatContext,
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
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

const MAX_PASSWORD_ATTEMPTS = 3;

interface FileProcessorProps {
  onSuccess?: () => void;
}

export function FileProcessor({ onSuccess }: FileProcessorProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [llmStatus, setLlmStatus] = useState<LLMStatus | null>(null);

  // Password dialog state
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordAttempts, setPasswordAttempts] = useState(0);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const setCurrency = useSettingsStore((state) => state.setCurrency);
  const currency = useSettingsStore((state) => state.currency);
  const llmModel = useSettingsStore((state) => state.llmModel);
  const setContext = useChatStore((state) => state.setContext);
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
    fileName: string,
  ) => {
    if (parsed.transactions.length === 0) {
      throw new Error(
        "No transactions found. Check if the file format is supported or try enabling AI parsing in Settings.",
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
        txn.currency,
        txn.originalAmount,
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

    // Build chat context
    const activeCurrency = detectedCurrency || currency;
    const chatCtx = buildChatContext(categorized, activeCurrency, fileName);
    setContext(chatCtx);

    // Store the model used for chat
    const activeModel = llmModel || llmStatus?.selectedModel;
    if (activeModel) {
      setModel(activeModel);
    }

    const currencyInfo = detectedCurrency
      ? ` (${detectedCurrency.code})`
      : "";
    setSuccess(
      `Parsed ${categorized.length} transactions${currencyInfo}! Redirecting to review…`,
    );

    // Close password dialog if open
    setPasswordDialogOpen(false);

    // Close dialog before redirect to prevent unmount issues
    onSuccess?.();

    setTimeout(() => router.push("/review"), 1000);
  }, [setCurrency, currency, llmModel, llmStatus?.selectedModel, setContext, setModel, onSuccess, router]);

  // Process a file with optional password (for PDFs)
  const processFile = useCallback(async (file: File, password?: string) => {
    const ext = file.name.toLowerCase();
    const isPDF = ext.endsWith(".pdf");
    const isCSV = ext.endsWith(".csv");
    const isXLS = ext.endsWith(".xls") || ext.endsWith(".xlsx");

    let parsed: ParsedStatement;
    let detectedCurrency: Currency | null = null;

    if (isPDF) {
      const result = await parseWithLLMExtended(file, setProgress, password);
      parsed = result.statement;
      detectedCurrency = result.currency;
      // Store CC statement metadata for the credit cards page
      if (result.ccStatement) {
        addCCStatement(result.ccStatement);
      }
    } else if (isCSV) {
      setProgress("Parsing CSV...");
      const result = await parseCSV(file);
      parsed = result.statement;
      detectedCurrency = result.detectedCurrency;
    } else if (isXLS) {
      setProgress("Parsing Excel file...");
      const result = await parseXLS(file);
      parsed = result.statement;
      detectedCurrency = result.detectedCurrency;
    } else {
      throw new Error(
        "Unsupported file format. Please upload a PDF, CSV, XLS, or XLSX file.",
      );
    }

    processParsedStatement(parsed, detectedCurrency, file.name);
  }, [processParsedStatement, addCCStatement]);

  // Handle password submission - retry with password
  const handlePasswordSubmit = useCallback(async (password: string) => {
    if (!pendingFile) return;

    setPasswordDialogOpen(false);
    setIsProcessing(true);
    setProgress("Parsing PDF with password...");

    try {
      await processFile(pendingFile, password);
      // Success - clear password state
      setPendingFile(null);
      setPasswordAttempts(0);
    } catch (err) {
      if (isPasswordError(err)) {
        const newAttempts = passwordAttempts + 1;
        setPasswordAttempts(newAttempts);

        if (newAttempts >= MAX_PASSWORD_ATTEMPTS) {
          // Too many failed attempts
          setPendingFile(null);
          setPasswordAttempts(0);
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
        setError(err instanceof Error ? err.message : "Failed to parse PDF file");
      }
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  }, [pendingFile, passwordAttempts, processFile]);

  // Handle password dialog cancel
  const handlePasswordCancel = useCallback(() => {
    setPasswordDialogOpen(false);
    setPendingFile(null);
    setPasswordAttempts(0);
    setPasswordError(null);
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
        setError(err instanceof Error ? err.message : "Failed to process file");
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
      <FileUpload onFileSelect={handleFileSelect} isProcessing={isProcessing} />

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

      {/* Progress */}
      {progress && (
        <Alert>
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertDescription>{progress}</AlertDescription>
        </Alert>
      )}

      {/* Processing (non-LLM) */}
      {isProcessing && !progress && (
        <Alert>
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertDescription>Processing your file…</AlertDescription>
        </Alert>
      )}

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
    </div>
  );
}
