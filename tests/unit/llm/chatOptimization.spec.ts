import { describe, it, expect } from 'vitest';

import { buildChatOptimizationPlan, estimateTokens } from '@/lib/llm/chatOptimization';
import type { ChatMessage } from '@/types';

function makeMessage(role: 'user' | 'assistant', content: string): ChatMessage {
  return { role, content, id: `msg-${Math.random()}`, timestamp: new Date().toISOString() };
}

describe('estimateTokens', () => {
  it('estimates ~1 token per 4 characters', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
  });

  it('returns at least 1 for non-empty strings', () => {
    expect(estimateTokens('a')).toBe(1);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('buildChatOptimizationPlan', () => {
  it('calculates contextMaxChars from model context length', () => {
    const plan = buildChatOptimizationPlan('ollama', 'What is my spending?', [], {
      modelContextLength: 8192,
    });

    // 8192 - 800 (response) - 300 (system) - question tokens - 0 history = ~7000+ tokens
    // contextMaxChars = tokens * 4 = 28000+
    expect(plan.contextMaxChars).toBeGreaterThan(20000);
    expect(plan.requestOptions.num_ctx).toBe(8192);
  });

  it('falls back to 4096 when no model context length provided', () => {
    const plan = buildChatOptimizationPlan('ollama', 'What is my spending?', []);

    expect(plan.requestOptions.num_ctx).toBe(4096);
    // 4096 - 800 - 300 - question(~8 tokens) = ~2988 tokens → ~11952 chars
    expect(plan.contextMaxChars).toBeGreaterThan(10000);
    expect(plan.contextMaxChars).toBeLessThan(13000);
  });

  it('handles large context models (32K)', () => {
    const plan = buildChatOptimizationPlan('ollama', 'Tell me about spending', [], {
      modelContextLength: 32768,
    });

    expect(plan.requestOptions.num_ctx).toBe(32768);
    // ~31500 tokens * 4 = ~126000 chars
    expect(plan.contextMaxChars).toBeGreaterThan(120000);
  });

  it('deducts history tokens from budget', () => {
    const messages = Array.from({ length: 8 }, (_, i) =>
      makeMessage(i % 2 === 0 ? 'user' : 'assistant',
        `This is a longer conversation message with some detail about financial transactions and spending patterns in the last few months including grocery shopping and utility payments. Message number ${i + 1}.`)
    );

    const planNoHistory = buildChatOptimizationPlan('ollama', 'What is my spending?', [], {
      modelContextLength: 8192,
    });
    const planWithHistory = buildChatOptimizationPlan('ollama', 'What is my spending?', messages, {
      modelContextLength: 8192,
    });

    expect(planWithHistory.contextMaxChars).toBeLessThan(planNoHistory.contextMaxChars);
  });

  it('uses fixed history window of 6', () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      makeMessage('user', `Message ${i}`)
    );

    const plan = buildChatOptimizationPlan('ollama', 'test', messages, {
      modelContextLength: 8192,
    });

    expect(plan.historyWindow).toBe(6);
  });

  it('builds correct Ollama request options', () => {
    const plan = buildChatOptimizationPlan('ollama', 'test', [], {
      modelContextLength: 8192,
    });

    expect(plan.requestOptions).toMatchObject({
      num_ctx: 8192,
      num_predict: 800,
      temperature: 0.05,
      top_p: 0.9,
      keep_alive: '15m',
    });
  });

  it('builds correct LM Studio request options', () => {
    const plan = buildChatOptimizationPlan('lmstudio', 'test', [], {
      modelContextLength: 8192,
    });

    expect(plan.requestOptions).toMatchObject({
      max_tokens: 800,
      temperature: 0.05,
      top_p: 0.9,
    });
    expect(plan.requestOptions).not.toHaveProperty('num_ctx');
  });

  it('handles zero context length gracefully', () => {
    const plan = buildChatOptimizationPlan('ollama', 'test', [], {
      modelContextLength: 0,
    });

    // All tokens consumed by overhead → contextMaxChars = 0
    expect(plan.contextMaxChars).toBe(0);
  });
});
