import { Transaction } from "@/types";
import type { ReviewSessionPayload } from "@/lib/pipelines/types";
import type { Summary } from "@/lib/parsers/extractSummary";
import { debugError } from "@/lib/utils/debug";

const REVIEW_SESSION_KEY = "review-session-v1";
const LEGACY_REVIEW_KEYS = ["pendingTransactions", "pendingVerificationReport"] as const;

interface ReviewSessionPayloadJSON {
  transactions: ReturnType<Transaction["toJSON"]>[];
  currency: ReviewSessionPayload["currency"];
  format: ReviewSessionPayload["format"];
  statementType: ReviewSessionPayload["statementType"];
  fileName: string;
  parseDate: string;
  statementSummary?: Summary | null;
  verificationReport?: ReviewSessionPayload["verificationReport"];
  warnings: string[];
  sourceMetadata?: ReviewSessionPayload["sourceMetadata"];
}

function canUseSessionStorage(): boolean {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

function clearLegacyKeys(): void {
  if (!canUseSessionStorage()) {
    return;
  }

  for (const key of LEGACY_REVIEW_KEYS) {
    sessionStorage.removeItem(key);
  }
}

export const reviewSessionRepository = {
  save(payload: ReviewSessionPayload): void {
    if (!canUseSessionStorage()) {
      return;
    }

    clearLegacyKeys();

    const serialized: ReviewSessionPayloadJSON = {
      transactions: payload.transactions.map((transaction) => transaction.toJSON()),
      currency: payload.currency,
      format: payload.format,
      statementType: payload.statementType,
      fileName: payload.fileName,
      parseDate: payload.parseDate.toISOString(),
      statementSummary: payload.statementSummary,
      verificationReport: payload.verificationReport,
      warnings: payload.warnings,
      sourceMetadata: payload.sourceMetadata,
    };

    sessionStorage.setItem(REVIEW_SESSION_KEY, JSON.stringify(serialized));
  },

  load(): ReviewSessionPayload | null {
    if (!canUseSessionStorage()) {
      return null;
    }

    clearLegacyKeys();

    const stored = sessionStorage.getItem(REVIEW_SESSION_KEY);
    if (!stored) {
      return null;
    }

    try {
      const parsed = JSON.parse(stored) as ReviewSessionPayloadJSON;
      return {
        transactions: parsed.transactions.map((transaction) => Transaction.fromJSON(transaction)),
        currency: parsed.currency,
        format: parsed.format,
        statementType: parsed.statementType,
        fileName: parsed.fileName,
        parseDate: new Date(parsed.parseDate),
        statementSummary: parsed.statementSummary,
        verificationReport: parsed.verificationReport,
        warnings: parsed.warnings ?? [],
        sourceMetadata: parsed.sourceMetadata,
      };
    } catch (error) {
      debugError('ReviewSession', 'Failed to parse session payload. Clearing corrupted data.', stored.slice(0, 100) + "...", error);
      sessionStorage.removeItem(REVIEW_SESSION_KEY);
      return null;
    }
  },

  clear(): void {
    if (!canUseSessionStorage()) {
      return;
    }

    sessionStorage.removeItem(REVIEW_SESSION_KEY);
    clearLegacyKeys();
  },
};
