import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkRateLimit, getClientIdentifier } from '@/lib/middleware/rateLimit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows within limit', () => {
    const result = checkRateLimit('user1', { limit: 10, windowMs: 60000 });
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('blocks over limit', () => {
    for (let i = 0; i < 10; i++) {
      checkRateLimit('user2', { limit: 10, windowMs: 60000 });
    }
    const result = checkRateLimit('user2', { limit: 10, windowMs: 60000 });
    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('resets after window', () => {
    checkRateLimit('user3', { limit: 5, windowMs: 1000 });
    vi.advanceTimersByTime(1100);
    const result = checkRateLimit('user3', { limit: 5, windowMs: 1000 });
    expect(result.success).toBe(true);
  });

  it('tracks per-identifier', () => {
    for (let i = 0; i < 10; i++) {
      checkRateLimit('userA', { limit: 10, windowMs: 60000 });
    }
    const resultA = checkRateLimit('userA', { limit: 10, windowMs: 60000 });
    const resultB = checkRateLimit('userB', { limit: 10, windowMs: 60000 });
    expect(resultA.success).toBe(false);
    expect(resultB.success).toBe(true);
  });

  it('returns correct remaining', () => {
    checkRateLimit('user4', { limit: 10, windowMs: 60000 });
    checkRateLimit('user4', { limit: 10, windowMs: 60000 });
    checkRateLimit('user4', { limit: 10, windowMs: 60000 });
    const result = checkRateLimit('user4', { limit: 10, windowMs: 60000 });
    expect(result.remaining).toBe(6);
  });
});

describe('getClientIdentifier', () => {
  it('extracts from X-Forwarded-For', () => {
    const req = { headers: { get: (h: string) => h === 'x-forwarded-for' ? '1.2.3.4, 5.6.7.8' : null } } as unknown as Request;
    expect(getClientIdentifier(req)).toBe('1.2.3.4');
  });

  it('falls back to X-Real-IP', () => {
    const req = { headers: { get: (h: string) => h === 'x-real-ip' ? '9.9.9.9' : null } } as unknown as Request;
    expect(getClientIdentifier(req)).toBe('9.9.9.9');
  });

  it('falls back to unknown', () => {
    const req = { headers: { get: () => null } } as unknown as Request;
    expect(getClientIdentifier(req)).toBe('unknown');
  });
});
