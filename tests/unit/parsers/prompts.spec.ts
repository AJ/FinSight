import { describe, it, expect } from 'vitest';
import { buildTransactionsPrompt } from '@/lib/parsers/extractTransactions';
import { formatCreditCardTransactionInput } from '@/lib/parsers/lineNumbering';
import {
  TYPE_DETECTION_PROMPT,
  CC_SUMMARY_PROMPT,
  CC_TRANSACTIONS_PROMPT,
  CC_REWARDS_PROMPT,
  BANK_SUMMARY_PROMPT,
  BANK_TRANSACTIONS_PROMPT,
  TYPE_DETECTION_SCHEMA,
  CC_SUMMARY_SCHEMA,
  CC_TRANSACTIONS_SCHEMA,
  BANK_TRANSACTIONS_SCHEMA,
  CC_REWARDS_SCHEMA,
  BANK_SUMMARY_SCHEMA,
} from '@/lib/parsers/prompts';

describe('prompt templates', () => {
  it('builds a request that preserves empty columns and requires the local header', () => {
    const input = formatCreditCardTransactionInput('DATE & TIME||||TRANSACTION DESCRIPTION||REWARDS||||||||AMOUNT||PI\n'
      + '12/09/2025 21:04||EMI||SwiggyBengaluru||||C||||||14,897.00||l');
    const prompt = buildTransactionsPrompt(input, 'credit_card');
    expect(prompt).toContain(input);
    expect(prompt).toContain('most recent preceding table header');
    expect(prompt).toContain('Empty cells and unnamed header cells retain their numbers');
    expect(prompt).toContain('do not include the [N] label or JSON quotation marks');
    expect(prompt).not.toContain('identify the column headers from the first row');
    // This checks request construction, not a live model's adherence to the rule.
  });
  const prompts = [
    TYPE_DETECTION_PROMPT,
    CC_SUMMARY_PROMPT,
    CC_TRANSACTIONS_PROMPT,
    CC_REWARDS_PROMPT,
    BANK_SUMMARY_PROMPT,
    BANK_TRANSACTIONS_PROMPT,
  ];

  it('all prompts are non-empty strings', () => {
    for (const prompt of prompts) {
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(100);
      // Prompts should contain JSON structure guidance for the LLM
      expect(prompt.toLowerCase()).toMatch(/json|response|output/);
    }
  });

  it('all prompts contain RAW_TEXT placeholder', () => {
    for (const prompt of prompts) {
      expect(prompt).toContain('{RAW_TEXT}');
    }
  });

  it('CC transaction prompt does NOT carry subtype guidance — extraction emits type only (D1)', () => {
    // D1: transactionSubType is decided by the classification pass, not extraction.
    expect(CC_TRANSACTIONS_PROMPT).not.toContain('transactionSubType');
  });

  it('CC transaction prompt requires reasoning for classification transparency', () => {
    expect(CC_TRANSACTIONS_PROMPT).toContain('reasoning');
    expect(CC_TRANSACTIONS_PROMPT).toContain('RULE 9 — REASONING');
  });
});

describe('parser structured-output schemas', () => {
  it('TYPE_DETECTION_SCHEMA has type enum and required core fields', () => {
    expect(TYPE_DETECTION_SCHEMA.type).toBe('object');
    expect(TYPE_DETECTION_SCHEMA.properties?.type?.enum).toEqual(['bank', 'credit_card', 'unknown']);
    expect(TYPE_DETECTION_SCHEMA.required).toEqual(['type', 'confidence']);
    expect(TYPE_DETECTION_SCHEMA.additionalProperties).toBe(true);
  });

  it('CC_TRANSACTIONS_SCHEMA enforces the transaction type enum only (D1: no subtype at extraction)', () => {
    const txn = CC_TRANSACTIONS_SCHEMA.properties?.transactions?.items;
    expect(txn?.properties?.type?.enum).toEqual(['debit', 'credit']);
    // D1: transactionSubType is a classification-pass output, not an extraction field.
    expect(txn?.properties?.transactionSubType).toBeUndefined();
    expect(txn?.required).toEqual(['date', 'description', 'amount', 'type']);
    expect(CC_TRANSACTIONS_SCHEMA.required).toEqual(['transactions']);
  });

  it('BANK_TRANSACTIONS_SCHEMA carries balance and same required core', () => {
    const txn = BANK_TRANSACTIONS_SCHEMA.properties?.transactions?.items;
    expect(txn?.properties?.balance?.type).toEqual(['number', 'null']);
    expect(txn?.required).toEqual(['date', 'description', 'amount', 'type']);
  });

  it('BANK_SUMMARY_SCHEMA marks all 9 fields required-as-nullable (never omit a key)', () => {
    expect(BANK_SUMMARY_SCHEMA.required).toEqual([
      'statementDate', 'statementPeriodStart', 'statementPeriodEnd', 'accountNumber',
      'accountHolderName', 'bankName', 'accountType', 'openingBalance', 'closingBalance',
    ]);
    for (const f of ['openingBalance', 'closingBalance']) {
      expect(BANK_SUMMARY_SCHEMA.properties?.[f]?.type).toEqual(['number', 'null']);
    }
  });

  it('CC_SUMMARY + CC_REWARDS are permissive objects', () => {
    expect(CC_SUMMARY_SCHEMA.required).toEqual(['previousBalanceCandidates']);
    expect(CC_SUMMARY_SCHEMA.additionalProperties).toBe(true);
    expect(CC_REWARDS_SCHEMA.additionalProperties).toBe(true);
  });
});

describe('extraction prompt trimming (D1: subtype moved to classification)', () => {
  it('subtype list is NOT in the extraction prompts — classification owns it', () => {
    expect(CC_TRANSACTIONS_PROMPT).not.toContain('Sub Types must be one of');
    expect(BANK_TRANSACTIONS_PROMPT).not.toContain('Sub Types must be one of');
  });

  it('type detection prompt carries the JSON skeleton (restored)', () => {
    expect(TYPE_DETECTION_PROMPT).toContain('Return ONLY a JSON object');
  });
});
