import { describe, it, expect } from 'vitest';
import { parseLLMJsonResponse } from '@/lib/utils/llm-response-parser';

describe('parseLLMJsonResponse', () => {
  it('parses clean JSON', () => {
    const result = parseLLMJsonResponse('{"key": "value"}');
    expect(result).toEqual({ key: 'value' });
  });

  it('strips markdown fences', () => {
    const result = parseLLMJsonResponse('```json\n{"key": "value"}\n```');
    expect(result).toEqual({ key: 'value' });
  });

  it('strips plain code fences', () => {
    const result = parseLLMJsonResponse('```\n{"key": "value"}\n```');
    expect(result).toEqual({ key: 'value' });
  });

  it('throws on invalid JSON', () => {
    expect(() => parseLLMJsonResponse('not json')).toThrow();
  });
});
