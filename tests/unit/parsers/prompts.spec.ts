import { describe, it, expect } from 'vitest';
import {
  TYPE_DETECTION_PROMPT,
  CC_SUMMARY_PROMPT,
  CC_TRANSACTIONS_PROMPT,
  CC_REWARDS_PROMPT,
  BANK_SUMMARY_PROMPT,
  BANK_TRANSACTIONS_PROMPT,
} from '@/lib/parsers/prompts';

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
