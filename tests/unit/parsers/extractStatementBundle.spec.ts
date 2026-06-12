import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import '@/lib/categorization/categories'; // Register categories before Transaction.fromExtracted uses them
import { extractStatementBundleFromRawText } from '@/lib/parsers/extractStatementBundle';
import { attachVerificationToExtractionBundle } from '@/lib/services/statementVerificationService';
import { createMockOllamaServer } from './helpers/mockOllamaServer';

type ExpectedBundle = {
  statementType: 'bank' | 'credit_card';
  transactionCount: number;
  verificationKind: 'bank' | 'credit_card';
  summary: Record<string, number>;
  transactions: Array<{
    description: string;
    amount: number;
    type: 'credit' | 'debit';
    sourceType: 'bank' | 'credit_card';
    transactionSubType?: string;
  }>;
};

async function loadFixture(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), 'tests', 'fixtures', 'parser', relativePath), 'utf8');
}

async function loadExpectedBundle(relativePath: string): Promise<ExpectedBundle> {
  const raw = await loadFixture(relativePath);
  return JSON.parse(raw) as ExpectedBundle;
}

describe('extractStatementBundleFromRawText', () => {
  it('returns a neutral bank extraction bundle and keeps verification in pre-review', async () => {
    const rawText = await loadFixture(path.join('bank', 'basic-bank.rawText.txt'));
    const expectedBundle = await loadExpectedBundle(path.join('bank', 'basic-bank.expected-bundle.json'));
    const expectedVerification = JSON.parse(
      await loadFixture(path.join('bank', 'basic-bank.expected-verification.json')),
    ) as { reconciliationPassed: boolean };
    const server = await createMockOllamaServer('bank');

    try {
      const bundle = await extractStatementBundleFromRawText({
        rawText,
        defaultCurrency: { code: 'INR', symbol: 'Rs.', name: 'Indian Rupee' },
        fileName: 'basic-bank.pdf',
        format: 'pdf',
        llmConfig: {
          provider: 'ollama',
          baseUrl: server.baseUrl,
          model: 'test-model',
        },
      });

      expect(bundle.statementType).toBe(expectedBundle.statementType);
      expect(bundle.transactions).toHaveLength(expectedBundle.transactionCount);
      expect(bundle.statementSummary).toMatchObject(expectedBundle.summary);
      expect(bundle.verificationInputs?.kind).toBe(expectedBundle.verificationKind);
      expect(bundle).not.toHaveProperty('verificationReport');
      expect(bundle.rawText).toContain('Opening Balance');

      expectedBundle.transactions.forEach((expectedTransaction, index) => {
        const actual = bundle.transactions[index];
        expect(actual.description).toBe(expectedTransaction.description);
        expect(actual.amount).toBe(expectedTransaction.amount);
        expect(actual.type).toBe(expectedTransaction.type);
        expect(actual.sourceType).toBe(expectedTransaction.sourceType);
      });

      const verifiedBundle = attachVerificationToExtractionBundle(bundle);
      expect(verifiedBundle.verificationReport).toBeDefined();
      expect('reconciliation' in verifiedBundle.verificationReport!).toBe(true);
      if ('reconciliation' in verifiedBundle.verificationReport!) {
        expect(verifiedBundle.verificationReport.reconciliation.passed).toBe(
          expectedVerification.reconciliationPassed,
        );
      }
    } finally {
      await server.close();
    }
  });

  it('returns a neutral credit-card extraction bundle and keeps verification in pre-review', async () => {
    const rawText = await loadFixture(path.join('credit-card', 'basic-cc.rawText.txt'));
    const expectedBundle = await loadExpectedBundle(path.join('credit-card', 'basic-cc.expected-bundle.json'));
    const expectedVerification = JSON.parse(
      await loadFixture(path.join('credit-card', 'basic-cc.expected-verification.json')),
    ) as { passed: boolean; reconciliationPassed?: boolean };
    const server = await createMockOllamaServer('credit_card');

    try {
      const bundle = await extractStatementBundleFromRawText({
        rawText,
        defaultCurrency: { code: 'INR', symbol: 'Rs.', name: 'Indian Rupee' },
        fileName: 'basic-cc.pdf',
        format: 'pdf',
        llmConfig: {
          provider: 'ollama',
          baseUrl: server.baseUrl,
          model: 'test-model',
        },
      });

      expect(bundle.statementType).toBe(expectedBundle.statementType);
      expect(bundle.transactions).toHaveLength(expectedBundle.transactionCount);
      expect(bundle.statementSummary).toMatchObject(expectedBundle.summary);
      expect(bundle.verificationInputs?.kind).toBe(expectedBundle.verificationKind);
      expect(bundle).not.toHaveProperty('verificationReport');
      expect(bundle.rawText).toContain('Total Due');

      expectedBundle.transactions.forEach((expectedTransaction, index) => {
        const actual = bundle.transactions[index];
        expect(actual.description).toBe(expectedTransaction.description);
        expect(actual.amount).toBe(expectedTransaction.amount);
        expect(actual.type).toBe(expectedTransaction.type);
        expect(actual.sourceType).toBe(expectedTransaction.sourceType);
        expect(actual.transactionSubType).toBe(expectedTransaction.transactionSubType);
      });

      const verifiedBundle = attachVerificationToExtractionBundle(bundle);
      expect(verifiedBundle.verificationReport).toBeDefined();
      expect('reconciliation' in verifiedBundle.verificationReport!).toBe(true);
      if ('reconciliation' in verifiedBundle.verificationReport!) {
        expect(verifiedBundle.verificationReport.reconciliation.passed).toBe(
          expectedVerification.reconciliationPassed ?? expectedVerification.passed,
        );
      }
    } finally {
      await server.close();
    }
  });
});
