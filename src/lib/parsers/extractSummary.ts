/**
 * Summary extraction pass.
 * 
 * Extracts high-level financial fields from statement.
 * CC: totalDue, minimumDue, creditLimit, previousBalance, etc.
 * Bank: openingBalance, closingBalance, account info, etc.
 */

import { CC_SUMMARY_PROMPT, BANK_SUMMARY_PROMPT } from './prompts';

export interface CCSummary {
  cardLastFour: string | null;
  cardIssuer: string | null;
  cardHolder: string | null;
  statementPeriodStart: string | null;
  statementPeriodEnd: string | null;
  statementDate: string | null;
  paymentDueDate: string | null;
  totalDue: number | null;
  minimumDue: number | null;
  creditLimit: number | null;
  availableCredit: number | null;
  previousBalance: number | null;
  paymentsReceived: number | null;
  purchasesAndCharges: number | null;
  interestCharged: number | null;
  lateFee: number | null;
  otherCharges: number | null;
  cashbackEarned: number | null;
  rewardPoints: {
    opening: number | null;
    earned: number | null;
    redeemed: number | null;
    closing: number | null;
  } | null;
  previousBalanceCandidates?: Array<{ label: string; value: number }>;  // For debugging extraction strategy
}

export interface BankSummary {
  statementDate: string | null;
  statementPeriodStart: string | null;
  statementPeriodEnd: string | null;
  accountNumber: string | null;
  accountHolderName: string | null;
  bankName: string | null;
  accountType: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
}

export type Summary = CCSummary | BankSummary;

/**
 * Build summary extraction prompt.
 */
export function buildSummaryPrompt(
  normalizedText: string,
  statementType: 'credit_card' | 'bank',
  bankName?: string | null,
): string {
  const bankContext = bankName ? ` issued by ${bankName.toUpperCase()}` : '';
  const promptTemplate = statementType === 'credit_card'
    ? CC_SUMMARY_PROMPT
    : BANK_SUMMARY_PROMPT;

  return promptTemplate
    .replace('{RAW_TEXT}', normalizedText)
    .replace('{BANK_CONTEXT}', bankContext);
}
