import { describe, it, expect } from 'vitest';
import { parseLLMJsonResponse } from '@/lib/utils/llm-response-parser';
import {
  CC_SUMMARY_SCHEMA,
  BANK_SUMMARY_SCHEMA,
  CC_TRANSACTIONS_SCHEMA,
  BANK_TRANSACTIONS_SCHEMA,
  TYPE_DETECTION_SCHEMA,
} from '@/lib/parsers/prompts';
import type { JSONSchema } from '@/lib/llm/types';

// Over-constraint safety net (spec §9.5). The schema must (a) define every field its parser
// reads — otherwise the grammar would forbid the model from emitting a field the parser
// expects — and (b) only mark `required` what the parser tolerates as mandatory. Pure, no
// mocks: this is a structural contract between two static modules.

function propertiesOf(schema: JSONSchema): Record<string, JSONSchema> {
  return schema.properties ?? {};
}

describe('schema defines every field its parser reads', () => {
  it('CC transactions schema covers the extracted-transaction fields', () => {
    const txn = propertiesOf(CC_TRANSACTIONS_SCHEMA).transactions?.items?.properties ?? {};
    for (const f of [
      'date', 'description', 'amount', 'type', 'reasoning', 'transactionSubType',
      'localCurrency', 'isInternationalTransaction', 'originalCurrency', 'originalAmount',
      'confidence',
    ]) {
      expect(txn[f], `missing ${f}`).toBeDefined();
    }
  });

  it('bank transactions schema covers balance', () => {
    const txn = propertiesOf(BANK_TRANSACTIONS_SCHEMA).transactions?.items?.properties ?? {};
    expect(txn.balance).toBeDefined();
  });

  it('bank summary schema defines all 9 fields the parser reads', () => {
    expect(new Set(Object.keys(propertiesOf(BANK_SUMMARY_SCHEMA)))).toEqual(
      new Set([
        'statementDate', 'statementPeriodStart', 'statementPeriodEnd', 'accountNumber',
        'accountHolderName', 'bankName', 'accountType', 'openingBalance', 'closingBalance',
      ]),
    );
  });

  it('cc summary schema defines the prompt-output fields', () => {
    const fields = new Set(Object.keys(propertiesOf(CC_SUMMARY_SCHEMA)));
    for (const f of [
      'previousBalanceCandidates', 'totalDue', 'minimumDue', 'creditLimit',
      'previousBalance', 'paymentsReceived', 'purchasesAndCharges', 'cashbackEarned',
    ]) {
      expect(fields.has(f), `missing ${f}`).toBe(true);
    }
  });

  it('schema required fields are a subset of what each parser tolerates as mandatory', () => {
    // Transactions: the parser treats a row as usable with date/description/amount/type;
    // the schema requires exactly those — never more (e.g. never `reasoning` or `balance`).
    expect(CC_TRANSACTIONS_SCHEMA.properties?.transactions?.items?.required).toEqual([
      'date', 'description', 'amount', 'type',
    ]);
    expect(BANK_TRANSACTIONS_SCHEMA.properties?.transactions?.items?.required).toEqual([
      'date', 'description', 'amount', 'type',
    ]);
    // Type detection: only the discriminating pair is mandatory.
    expect(TYPE_DETECTION_SCHEMA.required).toEqual(['type', 'confidence']);
  });
});

describe('a schema-conformant response parses cleanly through the real parser', () => {
  it('cc transactions round-trip', () => {
    const sample = JSON.stringify({
      transactions: [{ date: '2024-01-01', description: 'x', amount: 10, type: 'debit' }],
      _debug: { totalCount: 1, droppedTransactions: [] },
    });
    const parsed = parseLLMJsonResponse<{ transactions: unknown[] }>(sample);
    expect(parsed.transactions).toHaveLength(1);
  });

  it('type detection round-trip', () => {
    const parsed = parseLLMJsonResponse<{ type: string }>(
      JSON.stringify({ type: 'bank', confidence: 0.9 }),
    );
    expect(parsed.type).toBe('bank');
  });

  it('rewards round-trip with nulls', () => {
    const parsed = parseLLMJsonResponse<{ rewardPoints: { earned: number } }>(
      JSON.stringify({
        cashback: null,
        rewardPoints: { opening: null, earned: 10, redeemed: null, closing: 10 },
      }),
    );
    expect(parsed.rewardPoints.earned).toBe(10);
  });

  it('bank summary round-trip with all keys present (null when absent)', () => {
    const parsed = parseLLMJsonResponse<{ closingBalance: number | null }>(
      JSON.stringify({
        statementDate: '2024-01-31', statementPeriodStart: '2024-01-01',
        statementPeriodEnd: '2024-01-31', accountNumber: '123', accountHolderName: null,
        bankName: null, accountType: null, openingBalance: null, closingBalance: 500,
      }),
    );
    expect(parsed.closingBalance).toBe(500);
  });
});
