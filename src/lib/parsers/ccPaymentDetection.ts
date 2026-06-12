import { Transaction as CanonicalTransaction } from '@/models/Transaction';
import type { TransactionSubType } from '@/models/Transaction';
import { SourceType } from '@/types';
import type { Transaction } from '@/types';

const cashbackPatterns = /\b(?:cashback|valueback|reward\s*cash|reward\s*cashback)\b/i;

// Matches payment routing identifiers: NEFT/IMPS/UPI/RTGS followed by bank identifier,
// BillDesk (with or without asterisk separator), autopay, or tele-transfer.
const paymentRoutingPattern =
  /\b(?:neft|imps|upi|rtgs|billdesk|autopay|tele[- ]?transfer)[\s*]*(?:cc|card|credit\s*card)\b|\b(?:neft|imps|upi|rtgs)[\s-]*\w*[\s-]*(?:cc|card)\b/i;

// BillDesk followed by issuer name (with or without asterisk/space separator)
const billdeskWithIssuerPattern = /billdesk[\s*]+\w*(?:hdfc|icici|axis|sbi|kotak|citi|amex|idfc)/i;

// Matches when an issuer name appears alongside CC/card/bill/payment keywords.
// Issuers must be separate tokens to avoid partial matches (e.g. "hdfc" in "hdfcbank" is fine,
// but standalone issuer + "cc" must also work).
const issuerNames =
  /\b(?:hdfc|icici|axis|sbi|kotak|citi|amex|idfc|au\s+bank|bob|canara|pnb|hsbc|standard\s+chartered|scb|rbl|yes\s+bank)\b/i;
const ccContextPattern = /\b(?:cc|card|credit\s*card|bill|payment)\b/i;

function looksLikeCashback(text: string): boolean {
  return cashbackPatterns.test(text);
}

function looksLikeCCPayment(text: string): boolean {
  if (paymentRoutingPattern.test(text)) return true;
  if (billdeskWithIssuerPattern.test(text)) return true;

  // Issuer name must co-occur with a CC-related context word.
  if (issuerNames.test(text) && ccContextPattern.test(text)) return true;

  return false;
}

export function normalizeCCTransactionSubTypes(transactions: Transaction[]): Transaction[] {
  return transactions.map((transaction) => {
    if (transaction.sourceType !== SourceType.CreditCard) {
      return transaction;
    }
    if (!transaction.isCredit) {
      return transaction;
    }
    if (transaction.transactionSubType !== 'debt_payment') {
      return transaction;
    }

    const text = `${transaction.description} ${transaction.originalText ?? ''}`.toLowerCase();

    if (looksLikeCashback(text) || looksLikeCCPayment(text)) {
      return transaction;
    }

    return new CanonicalTransaction(
      transaction.id,
      transaction.date,
      transaction.description,
      transaction.amount,
      transaction.type,
      transaction.category,
      transaction.balance,
      transaction.merchant,
      transaction.originalText,
      transaction.budgetMonth,
      transaction.categoryConfidence,
      transaction.needsReview,
      transaction.categorizedBy,
      transaction.sourceType,
      transaction.statementId,
      transaction.cardIssuer,
      transaction.cardLastFour,
      transaction.cardHolder,
      transaction.localCurrency,
      transaction.originalCurrency,
      transaction.originalAmount,
      transaction.isInternational,
      transaction.isAnomaly,
      transaction.anomalyTypes,
      transaction.anomalyDetails,
      transaction.anomalyDismissed,
      'refund' as TransactionSubType,
      transaction.suggestedCategory,
      transaction.llmConfidence,
      transaction.verificationConfidence,
    );
  });
}
