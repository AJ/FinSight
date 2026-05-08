import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerate = vi.fn();

vi.mock('@/lib/llm/index', () => ({
  getClient: () => ({ generate: mockGenerate }),
}));

vi.mock('@/lib/utils/debug', () => ({
  debugLog: vi.fn(),
  debugWarn: vi.fn(),
  debugError: vi.fn(),
}));

import { detectStatementType } from '@/lib/parsers/typeDetection';
import type { LLMRuntimeConfig } from '@/lib/llm/types';

const baseConfig: LLMRuntimeConfig = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  model: 'llama3',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('detectStatementType', () => {
  it('detects bank statement', async () => {
    mockGenerate.mockResolvedValue(JSON.stringify({
      type: 'bank',
      confidence: 0.95,
      reason: 'Has opening/closing balance',
      bankName: 'HDFC',
    }));

    const result = await detectStatementType('some text', baseConfig);

    expect(result.statementType).toBe('bank');
    expect(result.confidence).toBe(0.95);
    expect(result.bankName).toBe('HDFC');
  });

  it('detects credit card statement', async () => {
    mockGenerate.mockResolvedValue(JSON.stringify({
      type: 'credit_card',
      confidence: 0.9,
      reason: 'Has credit limit and total due',
    }));

    const result = await detectStatementType('some text', baseConfig);

    expect(result.statementType).toBe('credit_card');
  });

  it.each(['cc', 'creditcard', 'credit_card_statement', 'card'])(
    'normalizes "%s" to credit_card',
    async (typeValue) => {
      mockGenerate.mockResolvedValue(JSON.stringify({ type: typeValue, confidence: 0.8 }));

      const result = await detectStatementType('text', baseConfig);

      expect(result.statementType).toBe('credit_card');
    },
  );

  it.each(['bank_statement', 'savings', 'current', 'checking'])(
    'normalizes "%s" to bank',
    async (typeValue) => {
      mockGenerate.mockResolvedValue(JSON.stringify({ type: typeValue, confidence: 0.8 }));

      const result = await detectStatementType('text', baseConfig);

      expect(result.statementType).toBe('bank');
    },
  );

  it('throws on unknown type', async () => {
    mockGenerate.mockResolvedValue(JSON.stringify({
      type: 'unknown',
      confidence: 0.3,
    }));

    await expect(detectStatementType('text', baseConfig)).rejects.toThrow('Unknown statement type');
  });

  it('throws on malformed LLM response', async () => {
    mockGenerate.mockResolvedValue('not json at all');

    await expect(detectStatementType('text', baseConfig)).rejects.toThrow('Type detection failed');
  });

  it('normalizes bankName "unknown" to null', async () => {
    mockGenerate.mockResolvedValue(JSON.stringify({
      type: 'bank',
      confidence: 0.9,
      bankName: 'unknown',
    }));

    const result = await detectStatementType('text', baseConfig);

    expect(result.bankName).toBeNull();
  });

  it('preserves real bankName', async () => {
    mockGenerate.mockResolvedValue(JSON.stringify({
      type: 'bank',
      confidence: 0.9,
      bankName: 'ICICI',
    }));

    const result = await detectStatementType('text', baseConfig);

    expect(result.bankName).toBe('ICICI');
  });

  it('truncates long text before sending to LLM', async () => {
    const longText = 'x'.repeat(1500);
    mockGenerate.mockResolvedValue(JSON.stringify({ type: 'bank', confidence: 0.9 }));

    await detectStatementType(longText, baseConfig);

    const prompt = mockGenerate.mock.calls[0][2] as string;
    expect(prompt).toContain('[document truncated for brevity]');
    expect(prompt).not.toContain(longText);
  });

  it('does not truncate short text', async () => {
    const shortText = 'short statement text';
    mockGenerate.mockResolvedValue(JSON.stringify({ type: 'bank', confidence: 0.9 }));

    await detectStatementType(shortText, baseConfig);

    const prompt = mockGenerate.mock.calls[0][2] as string;
    expect(prompt).toContain(shortText);
    expect(prompt).not.toContain('[document truncated');
  });

  it('defaults reason to empty string when missing from LLM response', async () => {
    mockGenerate.mockResolvedValue(JSON.stringify({
      type: 'bank',
      confidence: 0.9,
    }));

    const result = await detectStatementType('text', baseConfig);

    expect(result.reason).toBe('');
  });

  it('passes signal through to generate', async () => {
    mockGenerate.mockResolvedValue(JSON.stringify({ type: 'bank', confidence: 0.9 }));
    const controller = new AbortController();

    await detectStatementType('text', baseConfig, controller.signal);

    const opts = mockGenerate.mock.calls[0][3] as Record<string, unknown>;
    expect(opts.signal).toBe(controller.signal);
  });
});
