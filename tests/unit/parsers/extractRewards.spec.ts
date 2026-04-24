import { describe, it, expect } from 'vitest';
import { buildRewardsPrompt } from '@/lib/parsers/extractRewards';

describe('buildRewardsPrompt', () => {
  it('returns prompt when rewards section present', () => {
    const result = buildRewardsPrompt('Reward Points: 500\nCashback: ₹100');
    expect(result.length).toBeGreaterThan(100);
    expect(result).toContain('Reward Points: 500');
  });

  it('returns empty string when no rewards keywords', () => {
    const result = buildRewardsPrompt('Date,Desc,Amount\n01/01,AMAZON,1299');
    expect(result).toBe('');
  });

  it('detects cashback keyword', () => {
    const result = buildRewardsPrompt('Cashback earned: ₹54.32');
    expect(result.length).toBeGreaterThan(0);
  });

  it('detects points keyword', () => {
    const result = buildRewardsPrompt('Reward Points: 1000');
    expect(result.length).toBeGreaterThan(0);
  });
});
