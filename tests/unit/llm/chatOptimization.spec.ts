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

    expect(plan.contextMaxChars).toBeGreaterThan(20000);
    expect(plan.extra.num_ctx).toBe(8192);
  });

  it('returns zero contextMaxChars when no model context length provided', () => {
    const plan = buildChatOptimizationPlan('ollama', 'What is my spending?', []);

    expect(plan.extra.num_ctx).toBeUndefined();
    expect(plan.contextMaxChars).toBe(0);
  });

  it('handles large context models (32K)', () => {
    const plan = buildChatOptimizationPlan('ollama', 'Tell me about spending', [], {
      modelContextLength: 32768,
    });

    expect(plan.extra.num_ctx).toBe(32768);
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

  it('builds correct Ollama options', () => {
    const plan = buildChatOptimizationPlan('ollama', 'test', [], {
      modelContextLength: 8192,
    });

    expect(plan.temperature).toBe(0.05);
    expect(plan.maxTokens).toBe(800);
    expect(plan.extra).toMatchObject({
      num_ctx: 8192,
      top_p: 0.9,
      keep_alive: '15m',
    });
  });

  it('builds correct LM Studio options', () => {
    const plan = buildChatOptimizationPlan('lmstudio', 'test', [], {
      modelContextLength: 8192,
    });

    expect(plan.temperature).toBe(0.05);
    expect(plan.maxTokens).toBe(800);
    expect(plan.extra).toMatchObject({
      top_p: 0.9,
    });
    expect(plan.extra).not.toHaveProperty('num_ctx');
  });

  it('handles zero context length gracefully', () => {
    const plan = buildChatOptimizationPlan('ollama', 'test', [], {
      modelContextLength: 0,
    });

    expect(plan.contextMaxChars).toBe(0);
    expect(plan.extra.num_ctx).toBeUndefined();
  });
});
