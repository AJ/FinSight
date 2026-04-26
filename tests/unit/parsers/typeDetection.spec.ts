import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/llm/llmClient', () => ({
  callLLM: vi.fn(),
}));

vi.mock('@/lib/utils/debug', () => ({
  debugLog: vi.fn(),
  debugWarn: vi.fn(),
  debugError: vi.fn(),
}));

import { detectStatementType } from '@/lib/parsers/typeDetection';
import { callLLM } from '@/lib/llm/llmClient';
import type { LLMRuntimeConfig } from '@/lib/llm/types';

const mockCallLLM = vi.mocked(callLLM);

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
    mockCallLLM.mockResolvedValue(JSON.stringify({
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
    mockCallLLM.mockResolvedValue(JSON.stringify({
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
      mockCallLLM.mockResolvedValue(JSON.stringify({ type: typeValue, confidence: 0.8 }));

      const result = await detectStatementType('text', baseConfig);

      expect(result.statementType).toBe('credit_card');
    },
  );

  it.each(['bank_statement', 'savings', 'current', 'checking'])(
    'normalizes "%s" to bank',
    async (typeValue) => {
      mockCallLLM.mockResolvedValue(JSON.stringify({ type: typeValue, confidence: 0.8 }));

      const result = await detectStatementType('text', baseConfig);

      expect(result.statementType).toBe('bank');
    },
  );

  it('throws on unknown type', async () => {
    mockCallLLM.mockResolvedValue(JSON.stringify({
      type: 'unknown',
      confidence: 0.3,
    }));

    await expect(detectStatementType('text', baseConfig)).rejects.toThrow('Unknown statement type');
  });

  it('throws on malformed LLM response', async () => {
    mockCallLLM.mockResolvedValue('not json at all');

    await expect(detectStatementType('text', baseConfig)).rejects.toThrow('Type detection failed');
  });

  it('normalizes bankName "unknown" to null', async () => {
    mockCallLLM.mockResolvedValue(JSON.stringify({
      type: 'bank',
      confidence: 0.9,
      bankName: 'unknown',
    }));

    const result = await detectStatementType('text', baseConfig);

    expect(result.bankName).toBeNull();
  });

  it('preserves real bankName', async () => {
    mockCallLLM.mockResolvedValue(JSON.stringify({
      type: 'bank',
      confidence: 0.9,
      bankName: 'ICICI',
    }));

    const result = await detectStatementType('text', baseConfig);

    expect(result.bankName).toBe('ICICI');
  });

  it('truncates long text before sending to LLM', async () => {
    const longText = 'x'.repeat(1500);
    mockCallLLM.mockResolvedValue(JSON.stringify({ type: 'bank', confidence: 0.9 }));

    await detectStatementType(longText, baseConfig);

    const prompt = mockCallLLM.mock.calls[0][0] as string;
    // Should contain the truncation marker
    expect(prompt).toContain('[document truncated for brevity]');
    // Should not contain the full text
    expect(prompt).not.toContain(longText);
  });

  it('does not truncate short text', async () => {
    const shortText = 'short statement text';
    mockCallLLM.mockResolvedValue(JSON.stringify({ type: 'bank', confidence: 0.9 }));

    await detectStatementType(shortText, baseConfig);

    const prompt = mockCallLLM.mock.calls[0][0] as string;
    expect(prompt).toContain(shortText);
    expect(prompt).not.toContain('[document truncated');
  });

  it('defaults reason to empty string when missing from LLM response', async () => {
    mockCallLLM.mockResolvedValue(JSON.stringify({
      type: 'bank',
      confidence: 0.9,
    }));

    const result = await detectStatementType('text', baseConfig);

    expect(result.reason).toBe('');
  });

  it('passes signal through to callLLM', async () => {
    mockCallLLM.mockResolvedValue(JSON.stringify({ type: 'bank', confidence: 0.9 }));
    const controller = new AbortController();

    await detectStatementType('text', baseConfig, controller.signal);

    const opts = mockCallLLM.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.signal).toBe(controller.signal);
  });
});
