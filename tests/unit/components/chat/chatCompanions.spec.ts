import { describe, it, expect } from 'vitest';
import {
  buildChatMessages,
  classifyStreamError,
  resolveModelSelection,
  findModelContextLength,
  type ChatMessageLike,
  type ModelInfoLike,
} from '@/components/chat/chatCompanions';

describe('buildChatMessages', () => {
  const messages: ChatMessageLike[] = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
    { role: 'user', content: 'how much?' },
    { role: 'assistant', content: '₹5000' },
  ];

  it('prepends the system prompt and appends the user message (no context)', () => {
    const result = buildChatMessages(messages, 10, 'system-prompt', '', 'new question');

    expect(result[0]).toEqual({ role: 'system', content: 'system-prompt' });
    expect(result[result.length - 1]).toEqual({ role: 'user', content: 'new question' });
  });

  it('puts the statement context in the user message, not the system message', () => {
    const result = buildChatMessages(messages, 10, 'sys', 'CTX-DATA', 'q');

    // The system message holds only the persona — no statement data.
    expect(result[0]).toEqual({ role: 'system', content: 'sys' });
    // The context + question land together in the final user message.
    expect(result[result.length - 1]).toEqual({
      role: 'user',
      content: 'Statement context:\nCTX-DATA\n\nQuestion: q',
    });
  });

  it('slices history to window size', () => {
    const result = buildChatMessages(messages, 2, 'sys', '', 'q');
    // system + last 2 messages + user message = 4
    expect(result).toHaveLength(4);
    expect(result[1]).toEqual({ role: 'user', content: 'how much?' });
    expect(result[2]).toEqual({ role: 'assistant', content: '₹5000' });
  });

  it('handles empty messages', () => {
    const result = buildChatMessages([], 5, 'sys', '', 'q');
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('system');
    expect(result[1].role).toBe('user');
  });

  it('handles window larger than message count', () => {
    const result = buildChatMessages(messages.slice(0, 1), 100, 'sys', '', 'q');
    expect(result).toHaveLength(3);
  });
});

describe('classifyStreamError', () => {
  it('returns timeout message for timeout errors', () => {
    const err = new Error('Request timed out after 30s');
    expect(classifyStreamError(err)).toContain('timed out');
  });

  it('detects timeout case-insensitively', () => {
    const err = new Error('TIMED OUT');
    expect(classifyStreamError(err)).toContain('timed out');
  });

  it('returns connection error for other Error types', () => {
    const err = new Error('Network failure');
    expect(classifyStreamError(err)).toContain('Connection error');
  });

  it('returns connection error for non-Error thrown values', () => {
    expect(classifyStreamError('string error')).toContain('Connection error');
    expect(classifyStreamError(null)).toContain('Connection error');
    expect(classifyStreamError(undefined)).toContain('Connection error');
  });

  it('returns connection error for DOMException that is not timeout', () => {
    const err = new DOMException('Aborted', 'AbortError');
    expect(classifyStreamError(err)).toContain('Connection error');
  });
});

describe('resolveModelSelection', () => {
  const models: ModelInfoLike[] = [
    { id: 'llama3.2', contextLength: 8192 },
    { id: 'mistral', contextLength: 4096 },
  ];

  it('returns null when current model already exists in the list', () => {
    const result = resolveModelSelection('mistral', models);
    expect(result).toBeNull();
  });

  it('switches to first model when current is not in list', () => {
    const result = resolveModelSelection('nonexistent', models);
    expect(result).toEqual({ modelId: 'llama3.2', contextLength: 8192 });
  });

  it('switches to first model when current is null', () => {
    const result = resolveModelSelection(null, models);
    expect(result).toEqual({ modelId: 'llama3.2', contextLength: 8192 });
  });

  it('switches to first model when current is undefined', () => {
    const result = resolveModelSelection(undefined, models);
    expect(result).toEqual({ modelId: 'llama3.2', contextLength: 8192 });
  });

  it('returns null when model list is empty', () => {
    expect(resolveModelSelection('llama3.2', [])).toBeNull();
  });

  it('handles models without contextLength', () => {
    const noCtx: ModelInfoLike[] = [{ id: 'model-a' }];
    const result = resolveModelSelection(null, noCtx);
    expect(result).toEqual({ modelId: 'model-a', contextLength: null });
  });
});

describe('findModelContextLength', () => {
  const models: ModelInfoLike[] = [
    { id: 'llama3.2', contextLength: 8192 },
    { id: 'mistral', contextLength: 4096 },
    { id: 'noctx' },
  ];

  it('finds context length for existing model', () => {
    expect(findModelContextLength(models, 'llama3.2')).toBe(8192);
    expect(findModelContextLength(models, 'mistral')).toBe(4096);
  });

  it('returns null for model without context length', () => {
    expect(findModelContextLength(models, 'noctx')).toBeNull();
  });

  it('returns null for unknown model', () => {
    expect(findModelContextLength(models, 'unknown')).toBeNull();
  });

  it('returns null for empty model list', () => {
    expect(findModelContextLength([], 'anything')).toBeNull();
  });
});
