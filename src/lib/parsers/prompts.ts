/**
 * Statement Extraction Prompts
 *
 * All prompts for parsing bank and credit card statements.
 * Organized by extraction pass.
 */

import type { JSONSchema } from '@/lib/llm/types';

// Nullable helpers used by the co-located schema constants below (kept as documentation;
// not sent on the wire — see the schema-enforcement RCA).
const nullableString = (): JSONSchema => ({ type: ['string', 'null'] });
const nullableNumber = (): JSONSchema => ({ type: ['number', 'null'] });

/* ── Type Detection Prompt ────────────────────────────────── */

export const TYPE_DETECTION_PROMPT = `Analyze this document and determine whether it is a BANK statement or a CREDIT CARD statement.

DECIDE BY STRUCTURE, NOT BY TRANSACTION CONTENT.
The statement TYPE is a property of the document's summary/header block, not of its individual transactions. Transaction descriptions can mention credit cards, loans, EMI, payments, or transfers, and such descriptions can appear on EITHER kind of statement (a bank account paying a card bill; a credit card receiving a payment). They are content, not structure, and must NOT determine the type. Judge the TYPE only from the summary/header block.

CREDIT CARD statements carry a SUMMARY BLOCK with fields like:
- "credit limit", "available credit", "cash limit"
- "minimum amount due" / "minimum due"
- "total amount due" / "outstanding balance"
- "payment due date" / billing cycle / "statement period"
- "previous balance" / "brought forward"
- A 16-digit card number (or last 4) identifying the card

BANK statements carry a HEADER/SUMMARY with fields like:
- "account number" / "a/c no" / CRN / customer ID
- "opening balance" and "closing balance"
- A running balance column, or CR/DR columns
- Account type (savings, current, salary)

DECISION RULE (apply in order):
1. If the document has a credit-card SUMMARY BLOCK (credit limit / minimum due / due date / billing cycle), return "credit_card".
2. Else if it has a bank HEADER (account number / opening & closing balance / running balance), return "bank".
3. Return "unknown" ONLY if you genuinely cannot identify a summary/header block of EITHER type — for example the text is garbled, it is not a statement, or both a CC summary block and a bank header are truly present and you cannot tell which the document primarily is. Do NOT return "unknown" merely because transaction descriptions mix card and bank language; in that case apply the structural rule above.

CONFIDENCE:
- 0.9-1.0: Clear structural summary block of one type, none of the other.
- 0.7-0.9: One type's structure clearly dominant.
- 0.5-0.7: Weak structure, but one type still more likely.
- <0.5: No structural summary block of either type identifiable.

Return ONLY a JSON object:
{
  "type": "bank" | "credit_card" | "unknown",
  "confidence": 0.0 to 1.0,
  "reason": "cite the STRUCTURAL summary fields you found; ignore transaction narration",
  "bankName": "name of the issuing bank or 'unknown' if not found"
}

DOCUMENT TEXT:
---
{RAW_TEXT}
`;

/* ── Credit Card: Summary Pass (Pass 1) ──────────────────── */

export const CC_SUMMARY_PROMPT = `You are an expert credit card statement parser.

Your task is to extract ONLY summary-level fields from the following Credit Card statement {BANK_CONTEXT}.

IMPORTANT:
- DO NOT extract transactions
- DO NOT compute totals unless explicitly instructed
- DO NOT guess values
- If a value is not found, return null (NOT 0)

--------------------------------------------------
STEP 1 — FIND CANDIDATES

Scan the document and extract ALL possible candidates for:

previousBalanceCandidates:
Look for labels similar to:
- Previous Balance
- Previous Statement Balance
- Previous Statement Dues
- Balance Brought Forward
- Opening Balance (ONLY if clearly from previous cycle)

Return ALL matches with:
- label (exact text)
- value

IMPORTANT: The value may appear in different positions depending on the bank's format:
- On the same line as the label
- On the next line below the label
- In a column aligned with the label
- After a colon or separator

Find the numeric value that is clearly associated with the label.

--------------------------------------------------
STEP 2 — SELECT BEST CANDIDATE

Select previousBalance using:

Priority:
1. "Previous Balance" or equivalent
2. "Previous Statement Balance" or "Previous Statement Dues"
3. "Balance Brought Forward"
4. Opening balance ONLY if clearly tied to previous cycle

Rules:
- MUST NOT be totalDue
- MUST NOT be creditLimit
- MUST be <= creditLimit (if creditLimit exists)
- If no valid candidate found → return null

--------------------------------------------------
STEP 3 — EXTRACT OTHER FIELDS (DIRECT ONLY)

Extract the following fields STRICTLY from summary sections:

{
  "cardLastFour": string | null,
  "cardIssuer": string | null,
  "cardHolder": string | null,

  "statementDate": string | null,
  "statementPeriodStart": string | null,
  "statementPeriodEnd": string | null,

  "paymentDueDate": string | null,

  "totalDue": number | null,
  "minimumDue": number | null,

  "creditLimit": number | null,
  "availableCredit": number | null,

  "previousBalance": number | null,

  "paymentsReceived": number | null,

  "purchasesAndCharges": number | null,

  "interestCharged": number | null,
  "lateFee": number | null,

  "cashbackEarned": number | null
}

--------------------------------------------------
CRITICAL RULES

1. purchasesAndCharges:
- MUST be extracted ONLY from summary section
- DO NOT compute from transactions
- Look for:
  - Purchases
  - Retail Spends
  - Total Spends
  - Charges
  - Purchases/Debit
- Value may appear in equation format (see rule 3)

2. paymentsReceived:
- Look for:
  - Payments Received
  - Payments & Credits
  - Payments/Credits Received
  - Amount Paid
- Value may appear in equation format (see rule 3)

3. EQUATION FORMAT (some statements use this):
Some statements show summary values in equation format like:
  "60000 50000 + 80000 + 0 = 90000"

The formula is: Previous - Payments + Purchases + Finance = Total

Parse as:
- First number (before space): previousBalance
- Second number (after space, before +): paymentsReceived (this is SUBTRACTED in the formula)
- Third number (after first +): purchasesAndCharges
- Fourth number (after second +): financeCharges
- Number after =: totalDue

4. cashbackEarned:
- Includes cashback, valueback, reward-equivalent
- If not present → null

5. interestCharged:
- Look for: Finance Charges, Interest Charges, Interest Billed, Service Tax on Interest
- This is the interest component charged on outstanding balance
- If not present → null

6. lateFee:
- Look for: Late Payment Charges, Late Fee, Over Limit Fee, Penalty
- If not present → null

7. Dates:
- Convert to YYYY-MM-DD if possible
- Else return null

8. Amounts:
- Remove commas
- Convert to number
- No currency symbols

9. Missing values:
- Return null (NOT 0)
- 0 is ONLY valid if the statement explicitly shows "0" or "0.00"

--------------------------------------------------
OUTPUT FORMAT (STRICT JSON ONLY)

{
  "previousBalanceCandidates": [
    {
      "label": "string",
      "value": number
    }
  ],
  "cardLastFour": string | null,
  "cardIssuer": string | null,
  "cardHolder": string | null,

  "statementDate": string | null,
  "statementPeriodStart": string | null,
  "statementPeriodEnd": string | null,

  "paymentDueDate": string | null,

  "totalDue": number | null,
  "minimumDue": number | null,

  "creditLimit": number | null,
  "availableCredit": number | null,

  "previousBalance": number | null,

  "paymentsReceived": number | null,

  "purchasesAndCharges": number | null,

  "interestCharged": number | null,
  "lateFee": number | null,

  "cashbackEarned": number | null
}

--------------------------------------------------
DOCUMENT:
---
{RAW_TEXT}
`;

/* ── Credit Card: Transactions Pass (Pass 2) ─────────────── */

export const CC_TRANSACTIONS_PROMPT = `You are a deterministic financial data extraction engine.

Your task is to extract ALL individual transactions from this credit card statement {BANK_CONTEXT}.

--------------------------------
INPUT
--------------------------------

{RAW_TEXT}

--------------------------------
OUTPUT FORMAT (STRICT JSON)
--------------------------------

Return ONLY valid JSON. No explanation. No extra text. No markdown.

{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "merchant/description",
      "amount": number,
      "reasoning": "brief explanation of why this is debit or credit",
      "type": "debit" | "credit",
      "localCurrency": "statement local currency ISO code such as USD, EUR, SGD, or INR",
      "isInternationalTransaction": boolean,
      "originalCurrency": "USD" (omit if domestic),
      "originalAmount": number (omit if domestic),
      "confidence": 0.0 to 1.0 (optional - your confidence in this extraction),
      "sourceLine": number (the line number this transaction's line starts with)
    }
  ],
  "tableHeader": "the transaction table's header line copied exactly (including its leading line number), or null if no header row is visible",
  "_debug": {
    "totalCount": number,
    "droppedTransactions": [
      {
        "reason": "why dropped (e.g., amount unclear, date missing)",
        "rawText": "the problematic text"
      }
    ]
  }
}

CONFIDENCE SCALE (optional but helpful):
- 0.9-1.0: All fields clearly visible in statement (amount, date, merchant all unambiguous)
- 0.7-0.9: Most fields clear, minor ambiguity (e.g., date format unclear)
- 0.5-0.7: Some fields uncertain (e.g., amount hard to read, merchant name cut off)
- <0.5: Low confidence - multiple fields unclear or text is garbled

--------------------------------
EXTRACTION RULES
--------------------------------

RULE 1 — EXTRACT EVERY TRANSACTION
- Count the TOTAL NUMBER of transactions first
- Extract EVERY transaction — do NOT skip any
- Do NOT merge transactions — each row is separate
- Do NOT skip transactions that look similar

RULE 2 — NUMBER FORMATTING
- Indian statements use lakh format: 1,23,456.78
- Remove ALL commas: 1,23,456.78 → 123456.78
- Output as plain decimal without commas

RULE 3 — COLUMN STRUCTURE
Table cells are written as [N] followed by JSON-quoted text. N is the cell position, not part of its value. Match each [N] cell to the same [N] in the most recent preceding table header. Empty cells and unnamed header cells retain their numbers. Extract only the quoted contents of the matching cell; do not include the [N] label or JSON quotation marks in output values. Never substitute a value from another cell or merge different cells. For lines without cell labels, use the original text structure. The leading line number before the first || identifies the source line, not a cell.

RULE 4 - Keyword-based extraction:
- Keywords MAY support classification but MUST NOT override transaction context or type.
- Keywords MAY support classification but are hints only. Transaction context, type, and structural position (e.g. amount prefix, column position) always take priority over keyword matching.

RULE 5 — DEBIT VS CREDIT (CRITICAL)
Debit (money charged TO card):
- Purchases, shopping, dining, subscriptions
- Fees, interest, taxes, penalties
- Look for: no prefix, or "-" prefix, or "DR"

Credit (money credited TO card):
- CC Bill Payments (HINTS: "PAYMENT", "PAYZAPP", "UPI", "NEFT", "IMPS")
- Refunds, reversals, cashback
- Look for: "+" prefix, "CR" prefix or suffix, or payment keywords
- If amount has "+" prefix, it is ALWAYS a credit
- If amount has "CR" prefix or suffix, it is ALWAYS a credit
- If amount has "-" prefix, it is ALWAYS a debit
- If amount has "DR" prefix or suffix, it is ALWAYS a debit

`
//- If description contains refund keywords (REFUND, RETURN, REVERSAL), it is likely a credit even without "CR" keyword
//- If description contains payment keywords (PAYMENT, PAID, PAYZAPP, UPI, NEFT, IMPS), it is likely a debit even without "DR" keyword
+
`
IMPORTANT:
- Refunds are ALWAYS credits (keywords: "REFUND", "RETURN", "REVERSAL")
- Cashback is ALWAYS a credit
- If amount has "+" prefix or "CR" → type = "credit"
- If amount has "-" prefix or "DR" → type = "debit"
- The amount's sign may be written with or without a space after it: "+ 304.00" and "+304.00" are both credits; "- 29.00" and "-29.00" are both debits
- When a rewards column is present, its sign (+10 / -10) describes POINTS, never money. Determine type ONLY from the sign on the amount in the AMOUNT column. Example: "-10||+ 304.00" → credit refund (points went down, money came back). Example: "+ 10||304.00" → debit purchase
- Otherwise use context: merchant name = debit, refund/reversal keyword = credit
- CC bill payments are ALWAYS credits: "CC PAYMENT", "CREDIT CARD PAYMENT", "CARD PAYMENT", or payment rails (NEFT, UPI, IMPS, ACH, SEPA, WIRE, FPS, GIRO, DIRECT DEBIT, BILL PAY, AUTOPAY) combined with card or bill context
- A merchant purchase is NOT a bill payment just because the description contains "pay" or "payment" (e.g. "PAYPAL *MERCHANT" is a purchase, not a bill payment)
- If a row contains BOTH a reward-points delta and a cash amount, the reward-points sign MUST NOT determine transaction type
- Determine type from the CASH amount column only
- A negative reward-points change can appear on a refund row and does NOT make the transaction a debit
- A positive reward-points change can appear on a purchase row and does NOT make the transaction a credit
- Do NOT infer debit just because the merchant looks like a normal spender; signed cash amount takes priority over merchant context
- Do NOT rely on finding the matching original purchase anywhere else in the statement; classify the row on its own structure

Example:
- "20/10/2025| 16:43 Transaction Description + 10 304.00" - This is a *debit* transaction (purchase at merchant)
- "25/10/2025| 04:00 Transaction Description -10 + 304.00" - this is a *credit* transaction (refund from merchant)
- "20/10/2025| 00:00 URBAN COMPANY LIMITEDGURUGRAM -10 + 304.00" - the -10 is reward points redeemed/reduced, +304.00 is the cash amount, so this row is a *credit* and likely a *refund*
- "20/10/2025| 16:43 URBAN COMPANY LIMITEDGURUGRAM +10 304.00" - the +10 is reward points earned, 304.00 is the cash amount, so this row is a *debit* and likely a *purchase*

RULE 6 — AMOUNT EXTRACTION (CRITICAL)
The amount is ALWAYS in a separate column or position from the description.

DO NOT extract numbers that are part of the description text:
- Tax codes like "-29", "18%", "RATE 18.0" are NOT the amount
- Reference numbers, transaction IDs, voucher numbers are NOT the amount
- Any number embedded in the description text is NOT the amount

The amount will be:
- In a separate column from the description
- Usually formatted with currency symbol (₹, Rs) or as a standalone number
- The main monetary value of the transaction
- Some statements can contain a rewards point column before or after the amount column. Do not confuse reward points with the transaction amount.
- Some statements show reward points as small signed integers next to the real amount, for example -10 + 304.00 or +10 304.00
- In such rows:
  - -10 or +10 is reward points metadata
  - 304.00 or +304.00 is the actual money amount
  - transaction type must be derived from the money amount, not the reward-points delta

Example:
Description: "IGST-VPS2627827578828-RATE 18.0 -29 (Ref# VT123456)"
Amount: "12.35" (in a separate column, NOT the -29 from the description)
`
/*
RULE 7 — SUBTYPES (purchase, fee, charge, refund, rewards, interest, debt_payment, investment, withdrawal, adjustment, transfer)
1. Assign the most appropriate subtype:
IF type == "credit" (Important check)
   - "rewards": Reward cash credited (Look for: CASHBACK, VALUEBACK, REWARD CASH)
   - "adjustment": Account adjustments
   - "debt_payment": Credit card bill payment (Look for: PAYMENT, PAID, PAYZAPP, UPI, NEFT, IMPS)
   - "refund": Money back from merchant (Look for: REFUND, RETURN, CANCEL - but also any credit from a merchant)



IF type = "debit":
   - "fee": Bank charges ONLY (HINTS: FEE, CHARGE, PENALTY, LATE FEE, ANNUAL FEE, SERVICE FEE). NEVER assign this subtype if the description contains IGST, CGST, SGST, UGST, GST, TDS, or VAT — those are always a "charge".
   - "interest": Interest charged (HINTS: INTEREST, IGP, FINANCE CHARGE)
   - "purchase": Regular spending at merchants
   - "charge": Other charges not covered above
   - "investment": SIP debits, mutual fund purchases, stock purchases, crypto purchases

2. Keywords are hints, not requirements - use context. E.g., a credit from "URBAN COMPANY" is likely a refund even without the word "REFUND"
3. If no subtype keyword matches, use the most logical default
*/



/*
IMPORTANT: Determine type FIRST, then subtype:
1. FIRST determine if type is "debit" or "credit" using the rules above (+ prefix = credit, etc.)
2. THEN assign the most appropriate subtype:
   - "rewards": Reward cash credited (HINTS: CASHBACK, VALUEBACK, REWARD CASH)
   - "refund": Any credit from a merchant for returned/cancelled/reversed spend; this includes merchant credits where the row structure shows a credit amount even if the word "REFUND" is absent
   - "debt_payment": Use only for card payments from bank/account rails such as PAYMENT, PAYZAPP, UPI, NEFT, IMPS, autopay, or bank transfer-like descriptions
   - "purchase": Regular spending at merchants (most common for debits)
   - "FCY MARKUP FEE" is not a bank fee but a currency conversion charge, so classify it as "charge" subtype, not "fee". FCY markup fees are NOT international transactions — set isInternationalTransaction = false.
   - "fee": Bank charges ONLY (HINTS: FEE, CHARGE, PENALTY, LATE FEE, ANNUAL FEE, SERVICE FEE). NEVER assign this subtype if the description contains IGST, CGST, SGST, UGST, GST, TDS, or VAT — those are always a "charge".
   - "interest": Interest charged (HINTS: INTEREST, IGP, FINANCE CHARGE)
   - "adjustment": Account adjustments
   - "charge": Other charges not covered above
   - "investment": SIP debits, mutual fund purchases, stock purchases, crypto purchases
3. Keywords are hints, not requirements - use context. E.g., a credit from "URBAN COMPANY" is likely a refund even without the word "REFUND"
4. If no subtype keyword matches, use the most logical default (e.g., merchant debit = "purchase")
*/
+
`
RULE 8 - Forex/conversion charges are NOT international transactions:
- "FCY MARKUP FEE", forex charges, dynamic currency conversion (DCC) charges, international transaction fees, and foreign transaction fees are charged in the statement's local currency, so set isInternationalTransaction = false for them. (Their subtype — charge vs fee — is assigned by a later classification pass, not at extraction.)
`
/*
- "debt_payment": Credit card bill payment; Look for but not exclusive to: PAYMENT, PAID, PAYZAPP, UPI, NEFT, IMPS).
- "investment": SIP debits, mutual fund purchases, stock purchases, crypto purchases.

*/
+
`
RULE 9 — REASONING (REQUIRED)
- Every transaction MUST include a "reasoning" field explaining your type classification.
- For debit: explain what about the row indicates a charge (prefix, column position, context).
- For credit: explain what indicates money credited to the card (CR marker, payment keyword, refund context).
- Example: "Amount has no prefix and description is a merchant → debit"
`
/*
- Example: "Description contains PAYMENT and amount reduces card balance → credit/debt_payment"
*/
+
`
RULE 10 — DATE FORMAT
- Convert all dates to YYYY-MM-DD
- "15 Jan 2024" → "2024-01-15"
- "15/01/24" → "2024-01-15"
- CRITICAL: Do NOT include time, pipe characters, or other separators (e.g., output MUST BE "2025-10-04", AND MUST NOT be "2025-10-04|00:00")

RULE 11 — INTERNATIONAL TRANSACTIONS
- If TWO amounts shown (e.g., "GBP 38.60 = SGD 65.12"):
  - amount: 65.12 (the statement-local amount)
  - originalAmount: 38.60 (the foreign amount)
  - originalCurrency: "GBP"
  - isInternationalTransaction: true
- localCurrency MUST be the statement's local currency detected from the document. Do NOT assume INR.
- If only ONE amount shown, treat it as the statement-local amount and do not invent an original amount or original currency.

Example:
- Transaction row: $38.60 + 110 3,431.14
- 38.60 is the foreign/original amount in USD
- "+ 110" is reward points, not money
- 3,431.14 is the billed amount in the statement's local currency
- amount = 3431.14
- originalAmount = 38.60
- originalCurrency = USD
- isInternationalTransaction = true

IMPORTANT:
- In such rows, NEVER use the foreign currency amount as amount
- The billed/local amount is the main transaction amount
- Do NOT set localCurrency from the foreign currency symbol
- localCurrency must come from the statement context
- Reward points are not part of either amount


RULE 12 — WHAT IS A TRANSACTION
A transaction MUST have ALL THREE:
1. A specific DATE (not a date range, not a due date)
2. A MERCHANT NAME or specific payee
3. A specific AMOUNT

DO NOT EXTRACT:
- Legal disclaimers, terms & conditions
- Bank contact information
- Summary sections (reward points, cashback summaries)
- Header text, column headers, section titles
- Marketing text, offers, promotional content
- Interest calculation explanations
- Credit Card Bill Payment instructions

RULE 13 — LINE NUMBERS
- Every line of the input begins with its line number followed by || (for example "7||").
- The line number identifies the line; it is never a date, an amount, or a description.
- For each transaction, set sourceLine to the number of the line the transaction starts on.
- ONE transaction may span SEVERAL lines: when a description wraps, the text continues on the following lines (often without their own date or amount). Lines that continue the row above belong to THAT transaction — do not split a wrapped row into separate transactions, and do not treat a continuation line as its own transaction.
- If this input shows the transaction table's header row, copy that entire line exactly (including its leading number) into tableHeader. If no header row is visible in this input, set tableHeader to null.

--------------------------------
END
--------------------------------`;


/* ── Credit Card: Rewards Pass (Pass 3) ──────────────────── */

export const CC_REWARDS_PROMPT = `You are a deterministic financial data extraction engine.

Your task is to extract reward points and cashback data from this credit card statement.

--------------------------------
INPUT
--------------------------------

{RAW_TEXT}

--------------------------------
OUTPUT FORMAT (STRICT JSON)
--------------------------------

Return ONLY valid JSON. No explanation. No extra text. No markdown.

{
  "cashback": number or null,
  "rewardPoints": {
    "opening": number or null,
    "earned": number or null,
    "redeemed": number or null,
    "closing": number or null
  }
}

For any field not clearly present: return null.
For any field explicitly stated as zero: return 0.

--------------------------------
EXTRACTION RULES
--------------------------------

RULE 1 — CASHBACK VS POINTS
- Cashback: monetary value (₹), maps to "cashback" field
- Points: integer, dimensionless, maps to "rewardPoints.*" fields
- If statement has only cashback and no points, rewardPoints fields should be null
- If statement has only points and no cashback, cashback should be null

RULE 2 — LOCATE REWARDS SECTION
Look for section headers like:
- "Reward Points Summary"
- "Loyalty Points Statement"
- "Bonus Points Earned"
- "Cashback Earned"
- "Points Balance"

RULE 3 — IGNORE PROMOTIONAL TEXT
The rewards section is often followed by promotional offers.
Stop extraction at:
- "Important Information"
- "Terms"
- "Redeem your points"
- Next transaction section

RULE 4 — VERIFY REWARDS MATH
If all four points fields are present, verify:

  closing ≈ opening + earned - redeemed

Tolerance: ±1 point for rounding.

If this fails, recheck the extracted values.

--------------------------------
END
--------------------------------`;

/* ── Bank: Summary Pass (Pass 1) ─────────────────────────── */

export const BANK_SUMMARY_PROMPT = `You are a deterministic financial data extraction engine.

Your task is to extract ONLY the ACCOUNT SUMMARY fields from this bank statement {BANK_CONTEXT}.

--------------------------------
INPUT
--------------------------------

{RAW_TEXT}

--------------------------------
OUTPUT FORMAT (STRICT JSON)
--------------------------------

Return ONLY valid JSON. No explanation. No extra text. No markdown.

{
  "statementDate": "YYYY-MM-DD or null",
  "statementPeriodStart": "YYYY-MM-DD or null",
  "statementPeriodEnd": "YYYY-MM-DD or null",
  "accountNumber": "string or null",
  "accountHolderName": "string or null",
  "bankName": "string or null",
  "accountType": "string or null",
  "openingBalance": number or null,
  "closingBalance": number or null
}

For any field not clearly present: return null.
Never omit a key — always include all keys, using null for absent fields.

--------------------------------
EXTRACTION RULES
--------------------------------

RULE 1 — DO NOT GUESS
If a field is not clearly labeled and present → return null.
Never infer. Never estimate.

RULE 2 — DATE FORMAT
- Convert all dates to YYYY-MM-DD
- "15 Jan 2024" → "2024-01-15"
- "15/01/24" → "2024-01-15"
- CRITICAL: Do NOT include time, pipe characters, or other separators (e.g., output MUST BE "2025-10-04", AND MUST NOT be "2025-10-04|00:00")

RULE 3 — NUMERIC FORMAT
Return amounts as plain numbers.
No commas. No currency symbols.
Indian lakh-format: 1,23,456.78 → 123456.78
Overdraft (negative) balances: return as negative numbers.

RULE 4 — EXTRACTING openingBalance AND closingBalance

Treat openingBalance and closingBalance as two independent fields that may come from different locations in the statement. Extract each from wherever its own labelled value appears.

Use values explicitly labelled as an opening or closing balance. Examples include:
- Opening Balance
- Closing Balance
- Balance B/F
- Balance Brought Forward
- Balance C/F
- Balance Carried Forward

These labelled values may appear anywhere — a summary section, header/footer, or the first/last row of the transaction table. Extract from wherever the label appears.

Do NOT infer openingBalance or closingBalance from:
- the "Balance" or "Running Balance" column of transaction rows
- the first or last running balance in the transaction table
- values labelled Current Balance, Available Balance, Ledger Balance, or any other balance that is not explicitly labelled as an opening or closing balance.

--------------------------------
FIELD DEFINITIONS
--------------------------------

statementDate:
  Look for: "Statement Date", "Generated On", "Date of Statement"

statementPeriodStart:
  Look for: "From", "Period From", "Statement From"

statementPeriodEnd:
  Look for: "To", "Period To", "Statement To"

accountNumber:
  Look for: "Account Number", "A/C No", "Account No"
  Return as string to preserve leading zeros.

accountHolderName:
  Look for: "Account Holder", "Name", "Customer Name"

bankName:
  Look for: the institution name at the top of the statement.

accountType:
  Look for: "Savings Account", "Current Account", "Salary Account"
  Return as lowercase: "savings", "current", "salary"

openingBalance:
  Look for: "Opening Balance", "Balance B/F", "Balance Brought Forward"
  This is the balance at the START of the statement period.
  Negative (overdraft) balances should be returned as negative numbers.

closingBalance:
  Look for: "Closing Balance", "Balance C/F", "Balance Carried Forward"
  This is the balance at the END of the statement period.
  Negative (overdraft) balances should be returned as negative numbers.

--------------------------------
END
--------------------------------`;

/* ── Bank: Transactions Pass (Pass 2) ────────────────────── */

export const BANK_TRANSACTIONS_PROMPT = `You are a deterministic financial data extraction engine.

Your task is to extract ALL individual transactions from this bank statement {BANK_CONTEXT}.

--------------------------------
INPUT
--------------------------------

{RAW_TEXT}

--------------------------------
OUTPUT FORMAT (STRICT JSON)
--------------------------------

Return ONLY valid JSON. No explanation. No extra text. No markdown.

{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "merchant/description",
      "amount": number,
      "reasoning": "brief explanation of why this is debit or credit",
      "type": "debit" | "credit",
      "balance": number | null,
      "confidence": 0.0 to 1.0 (optional),
      "sourceLine": number (the line number this transaction's line starts with)
    }
  ],
  "openingBalance": number or null,
  "closingBalance": number or null,
  "tableHeader": "the transaction table's header line copied exactly (including its leading line number), or null if no header row is visible",
  "_debug": {
    "totalCount": number,
    "droppedTransactions": [
      {
        "reason": "why dropped (e.g., amount unclear, date missing)",
        "rawText": "the problematic text"
      }
    ]
  }
}

--------------------------------
EXTRACTION RULES
--------------------------------

RULE 1 — EXTRACT EVERY TRANSACTION
- Count the TOTAL NUMBER of transactions first
- Extract EVERY transaction — do NOT skip any
- Do NOT merge transactions — each row is separate

RULE 2 — COLUMN STRUCTURE
The input text may contain || separators that divide it into explicitly labeled columns. When present, identify the column headers from the first row. When || is not present, infer column boundaries from text alignment, spacing, or repeated patterns across rows. In either case, each column is strictly independent — map each column to at most one output field. Do not merge content from one column into another. Columns that don't map to any output field should be discarded entirely.

RULE 3 — NUMBER FORMATTING
- Indian statements use lakh format: 1,23,456.78
- Remove ALL commas: 1,23,456.78 → 123456.78
- Output as plain decimal without commas

RULE 4 — DATE FORMAT
- Convert all dates to YYYY-MM-DD
- "15 Jan 2024" → "2024-01-15"
- "15/01/24" → "2024-01-15"
- CRITICAL: Do NOT include time, pipe characters, or other separators (e.g., output MUST BE "2025-10-04", AND MUST NOT be "2025-10-04|00:00")

RULE 5 — DEBIT VS CREDIT (IN ORDER OF PRIORITY)
1. PIPE-DELIMITED COLUMNS: The first || on a line separates the line number from the row's content — column counting starts after it. Identify the column headers first, from the table's header row (it may appear at the top of the input even when the rows below it start mid-table). If an amount appears in the Debit column position, it is "debit"; if it appears in the Credit column position, it is "credit". An empty Debit column with an amount in the Credit column means type="credit".
2. SEPARATE COLUMNS: "Debit" column = "debit", "Credit" column = "credit"
3. KEYWORDS for DEBIT: DEBIT, DR, WITHDRAWAL, PAID, SENT, OUT, PAYMENT TO, TRANSFER TO
4. KEYWORDS for CREDIT: CREDIT, CR, DEPOSIT, RECEIVED, IN, REFUND, TRANSFER FROM
5. Negative amounts or amounts in parentheses = debit

RULE 6 — IGNORE RUNNING BALANCE COLUMN
Many statements have a "Balance" column showing running balance.
- DO NOT extract running balance values as transaction amounts
- Only extract amounts from Debit/Credit columns

RULE 7 — WHAT IS A TRANSACTION
A transaction MUST have ALL THREE:
1. A specific DATE
2. A MERCHANT NAME or description
3. A specific AMOUNT

Opening/closing balance rows are NOT transactions — never place them in the transactions array. Instead, read their values from the labelled rows at the boundaries of the transaction table (the first/last rows, labelled "Opening Balance", "Balance B/F", "Balance Brought Forward", "Closing Balance", "Balance C/F", or "Balance Carried Forward") and report them in the top-level openingBalance and closingBalance fields. If a labelled boundary row is not present, set the field to null.

DO NOT EXTRACT:
- Legal disclaimers, terms & conditions
- Bank contact information
- Header text, column headers, section titles

RULE 8 — RUNNING BALANCE (IF PRESENT)
Many statements include a "Balance" column showing running balance.
- If present, extract the balance value for each transaction
- Balance is the account balance AFTER the transaction is applied
- If not present, return null for balance field

RULE 9 — TYPE ONLY (subtype is assigned by a later classification pass)
Extract ONLY the transaction "type" (debit/credit). Do NOT assign or emit a transactionSubType —
that is decided by a separate classification pass. Omit transactionSubType from your output.
`
/*
IF type == "debit":
   - "purchase": Regular spending at merchants (shopping, dining, online orders)
   - "transfer": Generic transfers via payment rails — IMPS, NEFT, UPI, RTGS (HINTS: NEFT, IMPS, UPI, RTGS, TRANSFER TO, SENT TO)
   - "debt_payment": ONLY when narration EXPLICITLY says CC bill payment or loan EMI (HINTS: CC BILL, CREDIT CARD BILL, CARD BILL, BILLPAY, LOAN EMI, EMI, LOAN REPAYMENT, AUTOPAY). A bank name alone (HDFC, ICICI, AXIS) is NOT sufficient — IMPS to HDFC could be paying anyone.
   - "investment": SIP debits, mutual fund purchases, stock purchases, crypto purchases (HINTS: SIP, MF, MUTUAL FUND, STOCK, SHARE, DEMAT, ZERODHA, GROWW)
   - "fee": Bank charges (HINTS: FEE, CHARGE, PENALTY, SERVICE CHARGE)
   - "interest": Interest debited
   - "withdrawal": ATM cash withdrawals
   - "charge": Other debits not covered above

PRIORITY: If a debit narration contains IMPS/NEFT/UPI/RTGS without explicit CC BILL, EMI, or LOAN keywords, classify as "transfer" — NOT "debt_payment".

IF type == "credit":
   - "interest": Interest credited on savings/FD (HINTS: INTEREST, INT CR, INT P)
   - "rewards": Cashback credited (HINTS: CASHBACK, CASH BACK, REWARD)
   - "refund": Refunds from merchants (HINTS: REFUND, RETURN, CANCEL)
   - "transfer": Transfers from other accounts, cash deposits, salary credits, direct deposits (HINTS: NEFT, IMPS, UPI, RTGS, TRANSFER FROM, RECEIVED FROM, DEPOSIT, SALARY)
   - "adjustment": Account adjustments
*/
+
`
Keywords are hints, not requirements. Use transaction context to determine type.

RULE 10 — REASONING (REQUIRED)
- Every transaction MUST include a "reasoning" field explaining your type classification.
- For debit: explain what indicates money going out (column position, keyword, context).
- For credit: explain what indicates money coming in (column position, keyword, context).
- Example: "Amount in Debit column → debit"
- Example: "Amount in Credit column with NEFTINW keyword → credit"

RULE 11 — LINE NUMBERS
- Every line of the input begins with its line number followed by || (for example "7||").
- The line number identifies the line; it is never a date, an amount, or a description.
- For each transaction, set sourceLine to the number of the line the transaction starts on.
- ONE transaction may span SEVERAL lines: when a description wraps, the text continues on the following lines (often without their own date or amount). Lines that continue the row above belong to THAT transaction — do not split a wrapped row into separate transactions, and do not treat a continuation line as its own transaction.
- If this input shows the transaction table's header row, copy that entire line exactly (including its leading number) into tableHeader. If no header row is visible in this input, set tableHeader to null.

--------------------------------
END
--------------------------------`;

/* ── Structured-output schemas (co-located with their prompts) ───────────────
 * Permissive JSON Schemas sent on the wire for grammar-constrained decoding
 * (spec §5/§6). additionalProperties: true; only always-present fields are
 * `required`. The dormant subtype prose above is intentionally NOT restored
 * (spec §8.1) — the transactionSubType enum below enforces the allowed set.
 */

export const TYPE_DETECTION_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['bank', 'credit_card', 'unknown'] },
    confidence: { type: 'number' },
    reason: { type: 'string' },
    bankName: { type: 'string' },
  },
  required: ['type', 'confidence'],
  additionalProperties: true,
};

export const CC_SUMMARY_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    previousBalanceCandidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, value: { type: 'number' } },
        required: ['label', 'value'],
        additionalProperties: true,
      },
    },
    cardLastFour: nullableString(), cardIssuer: nullableString(), cardHolder: nullableString(),
    statementDate: nullableString(), statementPeriodStart: nullableString(), statementPeriodEnd: nullableString(),
    paymentDueDate: nullableString(),
    totalDue: nullableNumber(), minimumDue: nullableNumber(), creditLimit: nullableNumber(),
    availableCredit: nullableNumber(), previousBalance: nullableNumber(), paymentsReceived: nullableNumber(),
    purchasesAndCharges: nullableNumber(), interestCharged: nullableNumber(), lateFee: nullableNumber(),
    cashbackEarned: nullableNumber(),
  },
  required: ['previousBalanceCandidates'],
  additionalProperties: true,
};

const transactionBase: Record<string, JSONSchema> = {
  date: { type: 'string' },
  description: { type: 'string' },
  amount: { type: 'number' },
  reasoning: { type: 'string' },
  type: { type: 'string', enum: ['debit', 'credit'] },
  confidence: { type: 'number' },
  sourceLine: { type: ['number', 'null'] },
};

const debugSchema: JSONSchema = {
  type: 'object',
  properties: {
    totalCount: { type: 'number' },
    droppedTransactions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { reason: { type: 'string' }, rawText: { type: 'string' } },
        required: ['reason', 'rawText'],
        additionalProperties: true,
      },
    },
  },
  additionalProperties: true,
};

export const CC_TRANSACTIONS_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ...transactionBase,
          localCurrency: { type: 'string' },
          isInternationalTransaction: { type: 'boolean' },
          originalCurrency: { type: 'string' },
          originalAmount: { type: 'number' },
        },
        required: ['date', 'description', 'amount', 'type'],
        additionalProperties: true,
      },
    },
    tableHeader: { type: ['string', 'null'] },
    _debug: debugSchema,
  },
  required: ['transactions'],
  additionalProperties: true,
};

export const BANK_TRANSACTIONS_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ...transactionBase,
          balance: { type: ['number', 'null'] },
        },
        required: ['date', 'description', 'amount', 'type'],
        additionalProperties: true,
      },
    },
    openingBalance: nullableNumber(),
    closingBalance: nullableNumber(),
    tableHeader: { type: ['string', 'null'] },
    _debug: debugSchema,
  },
  required: ['transactions'],
  additionalProperties: true,
};

export const CC_REWARDS_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    cashback: nullableNumber(),
    rewardPoints: {
      type: ['object', 'null'],
      properties: {
        opening: nullableNumber(), earned: nullableNumber(),
        redeemed: nullableNumber(), closing: nullableNumber(),
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
};

export const BANK_SUMMARY_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    statementDate: nullableString(), statementPeriodStart: nullableString(), statementPeriodEnd: nullableString(),
    accountNumber: nullableString(), accountHolderName: nullableString(), bankName: nullableString(),
    accountType: nullableString(), openingBalance: nullableNumber(), closingBalance: nullableNumber(),
  },
  required: ['statementDate', 'statementPeriodStart', 'statementPeriodEnd', 'accountNumber',
    'accountHolderName', 'bankName', 'accountType', 'openingBalance', 'closingBalance'],
  additionalProperties: true,
};
