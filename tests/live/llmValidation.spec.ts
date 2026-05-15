import { describe, it, expect, beforeAll } from 'vitest';
import {
  isLiveLLMAvailable,
  getLiveLLMUrl,
  getLiveLLMModel,
  callLLM,
  callLLMStream,
  loadGoldenFixture,
  parseJsonFromResponse,
} from './helpers';

const describeLive = isLiveLLMAvailable() ? describe : describe.skip;

// Prompts used for extraction tasks
const TRANSACTION_EXTRACTION_PROMPT = `Extract all transactions from this statement. Return ONLY a JSON array. Each transaction: { "date": "YYYY-MM-DD", "description": "string", "amount": number (positive), "type": "credit"|"debit" }

Statement:
{text}`;

const TYPE_DETECTION_PROMPT = `Determine if this is a bank statement or credit card statement. Return ONLY JSON: { "type": "bank"|"credit_card", "confidence": number }

Text:
{text}`;

const RETRY_CORRECTION_PROMPT = `The previous extraction had issues. Some amounts were strings instead of numbers. Extract again ensuring all amounts are numeric. Return ONLY a JSON array.
Each transaction: { "date": "YYYY-MM-DD", "description": "string", "amount": number (positive), "type": "credit"|"debit" }

Statement:
{text}`;

const CATEGORIZATION_PROMPT = `You are a financial transaction categorization assistant. Categorize each transaction into the most appropriate category.

STRICT CATEGORY LIST - You MUST use ONLY these exact category IDs (do not invent new ones):
"groceries", "dining", "transportation", "utilities", "housing", "healthcare", "entertainment", "shopping", "income", "interest", "cashback", "transfer", "bills", "investment", "insurance", "education", "travel", "fees", "taxes", "interest-expense", "other"

Category guidance:
- "groceries": Supermarkets, grocery stores, fresh produce, food staples
- "dining": Restaurants, cafes, coffee shops, bars, takeout, food delivery
- "transportation": Fuel, public transit, ride-hailing, taxi, parking, tolls
- "utilities": Electricity, water, gas, internet, mobile, phone
- "housing": Rent, mortgage, housing maintenance, HOA
- "healthcare": Pharmacy, doctor, clinic, hospital
- "entertainment": Streaming, movies, games, concerts, subscriptions
- "shopping": Retail, e-commerce, electronics, apparel, home goods
- "income": Salary, payroll, freelance income, reimbursements
- "transfer": Money moved between accounts or people
- "bills": Credit-card bill payments, loan repayments, EMI
- "fees": Bank fees, service fees, annual fees, processing fees
- "other": Use only when genuinely unclear

Transactions:
{transactions}

Return ONLY a JSON array: [{"id": "original-id", "category": "category-id", "confidence": 0.95}]`;

// Known transactions with expected categories for accuracy testing
const KNOWN_TRANSACTIONS = [
  { id: 't1', description: 'SWIGGY ORDER #12345', amount: 450.00, direction: 'debit', expectedCategory: 'dining' },
  { id: 't2', description: 'AMAZON RETAIL INDIA', amount: 1299.00, direction: 'debit', expectedCategory: 'shopping' },
  { id: 't3', description: 'NETFLIX SUBSCRIPTION', amount: 649.00, direction: 'debit', expectedCategory: 'entertainment' },
  { id: 't4', description: 'OLA AUTO RIDE', amount: 120.00, direction: 'debit', expectedCategory: 'transportation' },
  { id: 't5', description: 'SALARY CREDIT - TCS', amount: 85000.00, direction: 'credit', expectedCategory: 'income' },
  { id: 't6', description: 'APOLLO PHARMACY', amount: 350.00, direction: 'debit', expectedCategory: 'healthcare' },
  { id: 't7', description: 'BIG BASKET GROCERY', amount: 2100.00, direction: 'debit', expectedCategory: 'groceries' },
  { id: 't8', description: 'ELECTRICITY BOARD - TATA POWER', amount: 3400.00, direction: 'debit', expectedCategory: 'utilities' },
  { id: 't9', description: 'HDFC CREDIT CARD PAYMENT', amount: 15000.00, direction: 'debit', expectedCategory: 'bills' },
  { id: 't10', description: 'BANK SERVICE CHARGE', amount: 500.00, direction: 'debit', expectedCategory: 'fees' },
];

describeLive('Live LLM Validation', () => {
  let url: string;
  let model: string;

  beforeAll(() => {
    url = getLiveLLMUrl();
    model = getLiveLLMModel();
  });

  // ---------------------------------------------------------------------------
  // Schema conformance
  // ---------------------------------------------------------------------------

  describe('Schema conformance', () => {
    it('bank statement extraction produces valid JSON array with required fields', async () => {
      const text = loadGoldenFixture('bankStatement.txt');
      const prompt = TRANSACTION_EXTRACTION_PROMPT.replace('{text}', text);
      const response = await callLLM(prompt, url, model);
      const parsed = parseJsonFromResponse(response);

      expect(Array.isArray(parsed), 'Response should be a JSON array').toBe(true);

      const transactions = parsed as Record<string, unknown>[];
      expect(transactions.length, 'Should extract at least one transaction').toBeGreaterThan(0);

      for (const txn of transactions) {
        expect(txn).toHaveProperty('date');
        expect(txn).toHaveProperty('description');
        expect(txn).toHaveProperty('amount');
        expect(txn).toHaveProperty('type');

        expect(typeof txn.date, 'date should be a string').toBe('string');
        expect(typeof txn.description, 'description should be a string').toBe('string');
        expect(typeof txn.amount, 'amount should be a number').toBe('number');
        expect(typeof txn.type, 'type should be a string').toBe('string');

        // date format check (YYYY-MM-DD)
        expect(txn.date as string, 'date should be YYYY-MM-DD').toMatch(
          /^\d{4}-\d{2}-\d{2}$/
        );

        // type should be credit or debit
        expect(['credit', 'debit']).toContain(txn.type);

        // amount should be positive
        expect(txn.amount as number, 'amount should be positive').toBeGreaterThan(0);
      }
    });

    it('credit card statement extraction produces valid JSON array with required fields', async () => {
      const text = loadGoldenFixture('ccStatement.txt');
      const prompt = TRANSACTION_EXTRACTION_PROMPT.replace('{text}', text);
      const response = await callLLM(prompt, url, model);
      const parsed = parseJsonFromResponse(response);

      expect(Array.isArray(parsed), 'Response should be a JSON array').toBe(true);

      const transactions = parsed as Record<string, unknown>[];
      expect(transactions.length, 'Should extract at least one transaction').toBeGreaterThan(0);

      for (const txn of transactions) {
        expect(txn).toHaveProperty('date');
        expect(txn).toHaveProperty('description');
        expect(txn).toHaveProperty('amount');
        expect(txn).toHaveProperty('type');

        expect(typeof txn.date, 'date should be a string').toBe('string');
        expect(typeof txn.description, 'description should be a string').toBe('string');
        expect(typeof txn.amount, 'amount should be a number').toBe('number');
        expect(typeof txn.type, 'type should be a string').toBe('string');

        expect(txn.date as string, 'date should be YYYY-MM-DD').toMatch(
          /^\d{4}-\d{2}-\d{2}$/
        );
        expect(['credit', 'debit']).toContain(txn.type);
        expect(txn.amount as number, 'amount should be positive').toBeGreaterThan(0);
      }
    });

    it('type detection returns valid classification structure', async () => {
      const text = loadGoldenFixture('bankStatement.txt').slice(0, 500);
      const prompt = TYPE_DETECTION_PROMPT.replace('{text}', text);
      const response = await callLLM(prompt, url, model);
      const parsed = parseJsonFromResponse(response) as Record<string, unknown>;

      expect(parsed).toHaveProperty('type');
      expect(parsed).toHaveProperty('confidence');

      expect(typeof parsed.type, 'type should be a string').toBe('string');
      expect(typeof parsed.confidence, 'confidence should be a number').toBe('number');

      expect(['bank', 'credit_card']).toContain(parsed.type);
      expect(parsed.confidence as number, 'confidence should be between 0 and 1').toBeGreaterThanOrEqual(0);
      expect(parsed.confidence as number, 'confidence should be between 0 and 1').toBeLessThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Type detection accuracy
  // ---------------------------------------------------------------------------

  describe('Type detection accuracy', () => {
    it('correctly identifies bank statement', async () => {
      const text = loadGoldenFixture('bankStatement.txt').slice(0, 500);
      const prompt = TYPE_DETECTION_PROMPT.replace('{text}', text);
      const response = await callLLM(prompt, url, model);
      const parsed = parseJsonFromResponse(response) as Record<string, unknown>;

      expect(parsed.type, 'Should classify as bank statement').toBe('bank');
    });

    it('correctly identifies credit card statement', async () => {
      const text = loadGoldenFixture('ccStatement.txt').slice(0, 500);
      const prompt = TYPE_DETECTION_PROMPT.replace('{text}', text);
      const response = await callLLM(prompt, url, model);
      const parsed = parseJsonFromResponse(response) as Record<string, unknown>;

      expect(parsed.type, 'Should classify as credit card statement').toBe('credit_card');
    });
  });

  // ---------------------------------------------------------------------------
  // Transaction extraction quality
  // ---------------------------------------------------------------------------

  describe('Transaction extraction quality', () => {
    it('extracts at least 80% of bank transactions (>= 14 of ~17)', async () => {
      const text = loadGoldenFixture('bankStatement.txt');
      const prompt = TRANSACTION_EXTRACTION_PROMPT.replace('{text}', text);
      const response = await callLLM(prompt, url, model);
      const parsed = parseJsonFromResponse(response);

      const transactions = parsed as Record<string, unknown>[];
      // Bank statement fixture has 17 transactions
      expect(
        transactions.length,
        `Expected >= 14 transactions, got ${transactions.length}`
      ).toBeGreaterThanOrEqual(14);
    });

    it('extracts at least 80% of credit card transactions (>= 13 of ~16)', async () => {
      const text = loadGoldenFixture('ccStatement.txt');
      const prompt = TRANSACTION_EXTRACTION_PROMPT.replace('{text}', text);
      const response = await callLLM(prompt, url, model);
      const parsed = parseJsonFromResponse(response);

      const transactions = parsed as Record<string, unknown>[];
      // CC statement fixture has 16 transactions
      expect(
        transactions.length,
        `Expected >= 13 transactions, got ${transactions.length}`
      ).toBeGreaterThanOrEqual(13);
    });
  });

  // ---------------------------------------------------------------------------
  // Retry recovery
  // ---------------------------------------------------------------------------

  describe('Retry recovery', () => {
    it('produces valid output after error correction prompt', async () => {
      const text = loadGoldenFixture('bankStatement.txt');

      // First extraction
      const firstPrompt = TRANSACTION_EXTRACTION_PROMPT.replace('{text}', text);
      await callLLM(firstPrompt, url, model);

      // Retry with correction prompt
      const retryPrompt = RETRY_CORRECTION_PROMPT.replace('{text}', text);
      const retryResponse = await callLLM(retryPrompt, url, model);
      const parsed = parseJsonFromResponse(retryResponse);

      expect(Array.isArray(parsed), 'Retry response should be a JSON array').toBe(true);

      const transactions = parsed as Record<string, unknown>[];
      expect(transactions.length, 'Should extract transactions on retry').toBeGreaterThan(0);

      // Verify all amounts are numeric (not strings)
      for (const txn of transactions) {
        expect(
          typeof txn.amount,
          `Amount for "${txn.description}" should be a number, got ${typeof txn.amount}`
        ).toBe('number');
        expect(
          Number.isNaN(txn.amount as number),
          `Amount should not be NaN`
        ).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Categorization accuracy
  // ---------------------------------------------------------------------------

  describe('Categorization accuracy', () => {
    it('categorizes at least 70% of known transactions correctly', async () => {
      const transactionList = JSON.stringify(
        KNOWN_TRANSACTIONS.map(({ id, description, amount, direction }) => ({
          id,
          description,
          amount,
          direction,
        })),
      );

      const prompt = CATEGORIZATION_PROMPT.replace('{transactions}', transactionList);
      const response = await callLLM(prompt, url, model);
      const parsed = parseJsonFromResponse(response);

      expect(Array.isArray(parsed), 'Response should be a JSON array').toBe(true);

      const results = parsed as Array<Record<string, unknown>>;
      expect(results.length, 'Should categorize all transactions').toBe(KNOWN_TRANSACTIONS.length);

      let correct = 0;
      for (const result of results) {
        const expected = KNOWN_TRANSACTIONS.find((t) => t.id === result.id);
        if (expected && result.category === expected.expectedCategory) {
          correct++;
        }
      }

      const accuracy = correct / KNOWN_TRANSACTIONS.length;
      expect(
        accuracy,
        `Expected >= 70% accuracy, got ${correct}/${KNOWN_TRANSACTIONS.length} (${(accuracy * 100).toFixed(0)}%)`
      ).toBeGreaterThanOrEqual(0.7);
    });

    it('uses only valid category IDs from the allowed list', async () => {
      const transactionList = JSON.stringify(
        KNOWN_TRANSACTIONS.map(({ id, description, amount, direction }) => ({
          id,
          description,
          amount,
          direction,
        })),
      );

      const prompt = CATEGORIZATION_PROMPT.replace('{transactions}', transactionList);
      const response = await callLLM(prompt, url, model);
      const parsed = parseJsonFromResponse(response);

      const results = parsed as Array<Record<string, unknown>>;
      const validCategories = [
        'groceries', 'dining', 'transportation', 'utilities', 'housing',
        'healthcare', 'entertainment', 'shopping', 'income', 'interest',
        'cashback', 'transfer', 'bills', 'investment', 'insurance',
        'education', 'travel', 'fees', 'taxes', 'interest-expense', 'other',
      ];

      for (const result of results) {
        expect(
          validCategories,
          `Category "${result.category}" is not in the allowed list`
        ).toContain(result.category);
      }
    });

    it('returns sensible confidence scores for unambiguous transactions', async () => {
      const unambiguous = [
        { id: 'u1', description: 'SWIGGY FOOD DELIVERY', amount: 350, direction: 'debit' },
        { id: 'u2', description: 'SALARY CREDIT - INFOSYS', amount: 95000, direction: 'credit' },
      ];

      const prompt = CATEGORIZATION_PROMPT.replace(
        '{transactions}',
        JSON.stringify(unambiguous),
      );
      const response = await callLLM(prompt, url, model);
      const parsed = parseJsonFromResponse(response);

      const results = parsed as Array<Record<string, unknown>>;
      for (const result of results) {
        const confidence = result.confidence as number;
        expect(
          confidence,
          `Confidence for "${(unambiguous.find((t) => t.id === result.id)?.description ?? 'unknown')}" should be >= 0.7 for unambiguous description, got ${confidence}`
        ).toBeGreaterThanOrEqual(0.7);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Streaming chat
  // ---------------------------------------------------------------------------

  describe('Streaming chat', () => {
    it('produces a coherent streamed response', async () => {
      const messages = [
        {
          role: 'user' as const,
          content: 'What are the main categories of personal finance expenses? List 5 categories in one short paragraph.',
        },
      ];

      const result = await callLLMStream(messages, url, model);

      expect(result.length, 'Streamed response should not be empty').toBeGreaterThan(0);
      expect(
        result.length,
        'Streamed response should be reasonably long (at least 50 chars)'
      ).toBeGreaterThanOrEqual(50);

      // Verify the response contains coherent text (not just whitespace or garbage)
      const trimmed = result.trim();
      expect(trimmed.length, 'Response should have non-whitespace content').toBeGreaterThan(0);

      // Check for at least a few words (basic coherence)
      const wordCount = trimmed.split(/\s+/).length;
      expect(
        wordCount,
        `Response should contain multiple words, got: "${trimmed.slice(0, 100)}..."`
      ).toBeGreaterThanOrEqual(10);
    });
  });
});
