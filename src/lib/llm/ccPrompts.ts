/**
 * Credit Card Statement - LLM Prompts
 *
 * Two-pass approach for local LLMs with limited context windows:
 * 1. Type detection (minimal tokens)
 * 2. Extraction with appropriate template
 */

import {
  TypeDetectionResult,
  CCExtractionResult,
} from '@/types/creditCard';

/* ── Pass 1: Statement Type Detection ─────────────────────── */

export const TYPE_DETECTION_PROMPT = `Analyze this document and determine if it is a bank statement or a credit card statement.

Look for these CREDIT CARD indicators:
- "credit limit", "available credit", "cash limit"
- "minimum amount due", "minimum due", "min due"
- "payment due date", "due date"
- "total amount due", "total due", "outstanding balance"
- "previous balance", "brought forward"
- Card number with 16 digits (or last 4 digits shown)
- "statement period" followed by billing cycle dates

Look for these BANK STATEMENT indicators:
- "account number", "a/c no"
- "opening balance", "closing balance"
- "cr" / "dr" columns for credits/debits
- Running balance column
- "cheque" references
- Account type (savings, current, salary)

Return ONLY a JSON object with your analysis:
{
  "type": "bank" | "credit_card" | "unknown",
  "confidence": 0.0 to 1.0
}

If you see BOTH bank and credit card indicators, prioritize credit card indicators.
If uncertain, return "unknown" with confidence < 0.5.

DOCUMENT TEXT (first portion):
---
`;

/* ── Pass 2a: Bank Statement Extraction (existing) ─────────── */

// Note: The existing PARSE_PROMPT from llmParser.ts will continue to be used
// for bank statements

/* ── Pass 2b: Credit Card Statement Extraction ─────────────── */

export const CC_EXTRACTION_PROMPT = `You are an expert credit card statement parser. Extract ALL information from this credit card statement.

STATEMENT-LEVEL INFORMATION TO EXTRACT:
1. cardLastFour: Last 4 digits of the credit card number
2. cardIssuer: Bank name (e.g., "HDFC Bank", "ICICI Bank", "Axis Bank")
3. cardHolder: Primary card holder name (if mentioned)
4. statementPeriodStart: Start date of statement period (YYYY-MM-DD)
5. statementPeriodEnd: End date of statement period (YYYY-MM-DD)
6. statementDate: Date the statement was generated (YYYY-MM-DD)
7. paymentDueDate: Payment deadline (YYYY-MM-DD)
8. totalDue: Total amount due / outstanding balance
9. minimumDue: Minimum payment required
10. creditLimit: Total credit limit on the card
11. availableCredit: Available credit remaining
12. previousBalance: Balance from previous statement
13. paymentsReceived: Total payments/credits received during period
14. purchasesAndCharges: Total new purchases/charges during period
15. interestCharged: Interest amount charged (if any, else 0)
16. lateFee: Late payment fee (if any, else 0)
17. otherCharges: Other fees/charges (if any, else 0)
18. addonCards: Array of addon/supplementary card holders if present

TRANSACTIONS TO EXTRACT:
For each transaction, extract:
- date: Transaction date in YYYY-MM-DD format
- description: Merchant name or transaction description
- amount: Amount in the card's native currency (e.g., INR for Indian cards)
- currency: Original currency if international (e.g., "USD", "EUR"), omit if domestic
- originalAmount: Amount in original currency if international, omit if domestic
- transactionType: One of "purchase", "payment", "refund", "cashback", "interest", "fee"
  - Use "cashback" for any cash back, cashback, cash_back, or CB entries (credits to the card)
- cardHolder: Name of addon card holder if this is an addon card transaction

CRITICAL RULES - WHAT IS A TRANSACTION:
A transaction MUST have ALL THREE of these characteristics:
1. A specific DATE (not a date range, not "expiring in", not a due date)
2. A MERCHANT NAME or specific payee (not generic bank text)
3. A specific AMOUNT (a number, not "points", not percentages)

DO NOT EXTRACT AS TRANSACTIONS:
- Legal disclaimers, terms & conditions, fine print
- Bank contact information, addresses, phone numbers
- Summary sections (reward points, cashback summaries, GST summaries)
- Header text, column headers, section titles
- Marketing text, offers, promotional content
- Interest calculation explanations
- Insurance information
- Payment instructions
- Text about "points expiring", "bonus points", "cash back"
- GST/invoice numbers and tax breakdowns
- Any text without a clear DATE + MERCHANT + AMOUNT combination

EXAMPLES OF NON-TRANSACTIONS (DO NOT EXTRACT):
❌ "Terms & Conditions apply, visit www.offers..." - No merchant/amount
❌ "BANK WILL REPORT YOU AS DEFAULTER..." - Legal disclaimer
❌ "Reward Points Summary" - Summary section, not individual transaction
❌ "GSTIN : 33AAACH2702H2Z6 HSN Code : 997113" - Tax info
❌ "Points expiring in next 30 days" - No specific transaction

EXAMPLES OF REAL TRANSACTIONS (EXTRACT THESE):
✅ "15/01/24  AMAZON INDIA CYBER SI  2,500.00" - Has date, merchant, amount
✅ "20/01/24  SWIGGY INSTAMART  850.00" - Has date, merchant, amount
✅ "25/01/24  PAYMENT RECEIVED - THANK YOU  -15,000.00" - Has date, merchant, amount

FOR ADDON/SUPPLEMENTARY CARDS:
- Look for section headers like "ADD-ON CARD TRANSACTIONS", "SUPPLEMENTARY CARD", or card holder names
- Attribute transactions in those sections to the named card holder
- Primary card transactions should have cardHolder omitted

OUTPUT FORMAT:
Return ONLY valid JSON with this structure:
{
  "statement": {
    "cardLastFour": "1234",
    "cardIssuer": "HDFC Bank",
    "cardHolder": "John Doe",
    "statementPeriodStart": "2024-01-01",
    "statementPeriodEnd": "2024-01-31",
    "statementDate": "2024-02-01",
    "paymentDueDate": "2024-02-20",
    "totalDue": 25000.00,
    "minimumDue": 1250.00,
    "creditLimit": 100000.00,
    "availableCredit": 75000.00,
    "previousBalance": 15000.00,
    "paymentsReceived": 15000.00,
    "purchasesAndCharges": 25000.00,
    "interestCharged": 0,
    "lateFee": 0,
    "otherCharges": 0,
    "addonCards": [
      { "cardHolderName": "Jane Doe" }
    ]
  },
  "transactions": [
    {
      "date": "2024-01-15",
      "description": "AMAZON INDIA",
      "amount": 2500.00,
      "transactionType": "purchase"
    },
    {
      "date": "2024-01-20",
      "description": "AIRBNB * HOST",
      "amount": 7500.00,
      "currency": "USD",
      "originalAmount": 89.00,
      "transactionType": "purchase"
    }
  ]
}

Do NOT include markdown fences. Output ONLY the JSON object.

CREDIT CARD STATEMENT TEXT:
---
`;

/* ── Helper Functions ──────────────────────────────────────── */

/**
 * Parse type detection result from LLM response
 */
export function parseTypeDetectionResult(raw: string): TypeDetectionResult {
  try {
    // Try direct parse
    const parsed = JSON.parse(raw);
    if (parsed.type && typeof parsed.confidence === 'number') {
      return {
        statementType: parsed.type,
        confidence: parsed.confidence,
      };
    }
  } catch {
    // Try extracting JSON from response
    const match = raw.match(/\{[^{}]*"type"[^{}]*"confidence"[^{}]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        return {
          statementType: parsed.type,
          confidence: parsed.confidence,
        };
      } catch {
        // Continue to default
      }
    }
  }

  // Default fallback
  return {
    statementType: 'unknown',
    confidence: 0,
  };
}

/**
 * Parse CC extraction result from LLM response
 */
export function parseCCExtractionResult(raw: string): CCExtractionResult | null {
  try {
    // Try direct parse
    return JSON.parse(raw) as CCExtractionResult;
  } catch {
    // Try extracting from code block
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim()) as CCExtractionResult;
      } catch {
        // Continue
      }
    }

    // Try finding JSON object
    const match = raw.match(/\{[\s\S]*"statement"[\s\S]*"transactions"[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as CCExtractionResult;
      } catch {
        // Try fixing common issues
        let fixed = match[0];
        fixed = fixed.replace(/,\s*([}\]])/g, '$1');
        try {
          return JSON.parse(fixed) as CCExtractionResult;
        } catch {
          // Give up
        }
      }
    }
  }

  return null;
}

/**
 * Validate CC extraction result has required fields
 */
export function validateCCExtractionResult(result: CCExtractionResult): boolean {
  const { statement } = result;

  // Check required statement fields
  if (!statement.cardLastFour || !statement.cardIssuer) return false;
  if (!statement.paymentDueDate || !statement.totalDue) return false;
  if (typeof statement.creditLimit !== 'number') return false;

  // Check transactions array
  if (!Array.isArray(result.transactions)) return false;

  return true;
}

/**
 * Get first N chars of text for type detection
 * (no need to send entire document for detection)
 */
export function getTextForDetection(text: string, maxChars: number = 3000): string {
  if (text.length <= maxChars) return text;

  // Get first portion which typically contains statement headers
  // and summary info that helps identify statement type
  return text.substring(0, maxChars);
}
