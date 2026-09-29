import { describe, it, expect } from 'vitest';
import { buildTransactionsPrompt } from '@/lib/parsers/extractTransactions';

describe('buildTransactionsPrompt', () => {
  it('returns CC transaction prompt', () => {
    const result = buildTransactionsPrompt('raw text', 'credit_card');
    expect(result).toContain('raw text');
    // D1: extraction emits type only. transactionSubType is decided by the classification
    // pass, so the extraction prompt must NOT ask for it.
    expect(result).not.toContain('transactionSubType');
    expect(result.length).toBeGreaterThan(100);
  });

  it('returns bank transaction prompt', () => {
    const result = buildTransactionsPrompt('raw text', 'bank');
    expect(result).toContain('raw text');
    expect(result).toContain('debit');
    expect(result.length).toBeGreaterThan(100);
  });

  it('includes bank name in context', () => {
    const result = buildTransactionsPrompt('raw text', 'bank', 'HDFC');
    expect(result).toContain('HDFC');
  });

  it('inserts source contents literally, without expanding replacement tokens', () => {
    const source = '2||[1] "Merchant $& $\' $` $$ {BANK_CONTEXT}"';
    expect(buildTransactionsPrompt(source, 'credit_card', 'Bank $&')).toContain(source);
    expect(buildTransactionsPrompt(source, 'credit_card', 'Bank $&')).toContain('issued by BANK $&');
  });
});

// ─── Row identity: line-number rules in the transactions prompts ────────────

import {
  CC_TRANSACTIONS_PROMPT,
  BANK_TRANSACTIONS_PROMPT,
  CC_TRANSACTIONS_SCHEMA,
  BANK_TRANSACTIONS_SCHEMA,
} from '@/lib/parsers/prompts';

describe('transactions prompts — line-number rules (row identity)', () => {
  it('bank prompt documents sourceLine, tableHeader, and the line number', () => {
    expect(BANK_TRANSACTIONS_PROMPT).toContain('sourceLine');
    expect(BANK_TRANSACTIONS_PROMPT).toContain('tableHeader');
    expect(BANK_TRANSACTIONS_PROMPT).toContain('line number');
  });

  it('credit card prompt documents sourceLine, tableHeader, and the line number', () => {
    expect(CC_TRANSACTIONS_PROMPT).toContain('sourceLine');
    expect(CC_TRANSACTIONS_PROMPT).toContain('tableHeader');
    expect(CC_TRANSACTIONS_PROMPT).toContain('line number');
  });

  it('bank RULE 5 anchors column counting after the leading line number', () => {
    expect(BANK_TRANSACTIONS_PROMPT).toContain('column counting starts after it');
  });

  it('both transaction schemas expose sourceLine and tableHeader', () => {
    const ccProps = CC_TRANSACTIONS_SCHEMA.properties as Record<string, { items?: { properties?: Record<string, unknown> } }>;
    expect(ccProps.transactions?.items?.properties?.sourceLine).toBeDefined();
    expect(ccProps.tableHeader).toBeDefined();

    const bankProps = BANK_TRANSACTIONS_SCHEMA.properties as Record<string, { items?: { properties?: Record<string, unknown> } }>;
    expect(bankProps.transactions?.items?.properties?.sourceLine).toBeDefined();
    expect(bankProps.tableHeader).toBeDefined();
  });
});
