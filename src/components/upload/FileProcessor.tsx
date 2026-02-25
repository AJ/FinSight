"use client";

import { useState, useEffect } from "react";
import { FileUpload } from "./FileUpload";
import { PasswordDialog } from "./PasswordDialog";
import { parseCSV } from "@/lib/parsers/csvParser";
import {
  parsePDF,
  isPasswordError,
} from "@/lib/parsers/pdfParser";
import { parseXLS } from "@/lib/parsers/xlsParser";
import { checkLLMStatus, buildChatContext } from "@/lib/parsers/llmParser";
import { normalizeMerchantName } from "@/lib/categorizer";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { useChatStore } from "@/lib/store/chatStore";
import { LLMStatus, ParsedStatement, Currency } from "@/types";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, XCircle } from "lucide-react";

const MAX_PASSWORD_ATTEMPTS = 3;

export function FileProcessor() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [llmStatus, setLlmStatus] = useState<LLMStatus | null>(null);

  // Password dialog state
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordAttempts, setPasswordAttempts] = useState(0);
  const [isPasswordProcessing, setIsPasswordProcessing] = useState(false);

  const setCurrency = useSettingsStore((state) => state.setCurrency);
  const currency = useSettingsStore((state) => state.currency);
  const llmModel = useSettingsStore((state) => state.llmModel);
  const setContext = useChatStore((state) => state.setContext);
  const setModel = useChatStore((state) => state.setModel);
  const router = useRouter();

  // Check LLM status on mount
  useEffect(() => {
    checkLLMStatus().then(setLlmStatus);
  }, []);

  // Common processing logic for parsed statements
  const processParsedStatement = (
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

    // Assign simple categories: credit or debit
    const categorized = parsed.transactions.map((txn) => ({
      ...txn,
      category: txn.type === "income" ? "credit" : "debit",
      merchant: normalizeMerchantName(txn.description),
    }));

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

    setTimeout(() => router.push("/review"), 1000);
  };

  // Process a file with optional password (for PDFs)
  const processFile = async (file: File, password?: string) => {
    const ext = file.name.toLowerCase();
    const isPDF = ext.endsWith(".pdf");
    const isCSV = ext.endsWith(".csv");
    const isXLS = ext.endsWith(".xls") || ext.endsWith(".xlsx");

    let parsed: ParsedStatement;
    let detectedCurrency: Currency | null = null;

    if (isPDF) {
      setProgress("Parsing PDF...");
      const result = await parsePDF(file, password);
      parsed = result.statement;
      detectedCurrency = result.detectedCurrency;
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
  };

  const handleFileSelect = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setSuccess(null);
    setProgress(null);
    setPasswordAttempts(0);
    setPasswordError(null);

    try {
      await processFile(file);
    } catch (err) {
      console.error("Error processing file:", err);

      // Check if this is a password error for PDF
      if (isPasswordError(err)) {
        // PDF is encrypted - show password dialog
        setPendingFile(file);
        setPasswordDialogOpen(true);
        setIsProcessing(false);
        setProgress(null);
        return;
      }

      setError(err instanceof Error ? err.message : "Failed to process file");
    } finally {
      if (!passwordDialogOpen) {
        setIsProcessing(false);
        setProgress(null);
      }
    }
  };

  const handlePasswordSubmit = async (password: string) => {
    if (!pendingFile) return;

    setIsPasswordProcessing(true);
    setPasswordError(null);
    setIsProcessing(true);
    setProgress("Parsing PDF with password...");

    try {
      await processFile(pendingFile, password);

      // Success - clear password state and close dialog
      setPasswordDialogOpen(false);
      setPendingFile(null);
      setPasswordAttempts(0);
    } catch (err) {
      console.error("Error processing password-protected PDF:", err);

      if (isPasswordError(err)) {
        const newAttempts = passwordAttempts + 1;
        setPasswordAttempts(newAttempts);

        if (newAttempts >= MAX_PASSWORD_ATTEMPTS) {
          // Too many failed attempts - close dialog with error
          setPasswordDialogOpen(false);
          setPendingFile(null);
          setPasswordAttempts(0);
          setError(
            "Too many failed password attempts. Please try uploading again.",
          );
        } else {
          // Show error with remaining attempts
          const remaining = MAX_PASSWORD_ATTEMPTS - newAttempts;
          setPasswordError(
            `Incorrect password. ${remaining} attempt${remaining > 1 ? "s" : ""} remaining.`,
          );
        }
      } else {
        // Other error - close dialog, show generic error
        setPasswordDialogOpen(false);
        setPendingFile(null);
        setPasswordAttempts(0);
        setError(
          err instanceof Error ? err.message : "Failed to parse PDF file",
        );
      }
    } finally {
      setIsPasswordProcessing(false);
      setIsProcessing(false);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-4">
      <FileUpload onFileSelect={handleFileSelect} isProcessing={isProcessing} />

      {/* Password Dialog */}
      <PasswordDialog
        open={passwordDialogOpen}
        onOpenChange={setPasswordDialogOpen}
        onSubmit={handlePasswordSubmit}
        error={passwordError || undefined}
        isProcessing={isPasswordProcessing}
      />

      {/* Progress */}
      {progress && (
        <Alert>
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <AlertDescription>{progress}</AlertDescription>
          </div>
        </Alert>
      )}

      {/* Processing (non-LLM) */}
      {isProcessing && !progress && (
        <Alert>
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <AlertDescription>Processing your file…</AlertDescription>
          </div>
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
        <Alert className="border-success bg-success/10">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <AlertDescription className="text-success-foreground">
            {success}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
