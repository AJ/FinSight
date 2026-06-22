import { describe, it, expect } from 'vitest';
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
import { TRANSACTION_SUB_TYPES } from '@/models/Transaction';

describe('prompt templates', () => {
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

  it('CC transaction prompt contains subtype guidance', () => {
    expect(CC_TRANSACTIONS_PROMPT).toContain('transactionSubType');
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

  it('CC_TRANSACTIONS_SCHEMA enforces transaction type + subtype enums', () => {
    const txn = CC_TRANSACTIONS_SCHEMA.properties?.transactions?.items;
    expect(txn?.properties?.type?.enum).toEqual(['debit', 'credit']);
    expect(txn?.properties?.transactionSubType?.enum).toEqual([...TRANSACTION_SUB_TYPES]);
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

describe('subtype enum toggle (default true) and prompt trimming', () => {
  it('subtype list is still present in the transactions prompt', () => {
    expect(CC_TRANSACTIONS_PROMPT).toContain('Sub Types must be one of');
    expect(CC_TRANSACTIONS_PROMPT).toContain('"purchase"');
    expect(BANK_TRANSACTIONS_PROMPT).toContain('Sub Types must be one of');
  });

  it('type detection prompt carries the JSON skeleton (restored)', () => {
    expect(TYPE_DETECTION_PROMPT).toContain('Return ONLY a JSON object');
  });
});
