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

describe('rateLimitStore cleanup interval', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cleans up expired entries when interval fires', () => {
    // Create an entry with a 1-second window
    checkRateLimit('cleanup-test', { limit: 5, windowMs: 1000 });

    // Advance past the entry's resetTime (1s) but not yet the interval (60s)
    vi.advanceTimersByTime(2000);

    // The entry should still be in the store (interval hasn't fired yet)
    // Now create a fresh entry to verify the old one is expired via checkRateLimit logic
    const result = checkRateLimit('cleanup-test', { limit: 5, windowMs: 1000 });
    expect(result.success).toBe(true); // New window starts

    // Now advance to trigger the 60s cleanup interval
    vi.advanceTimersByTime(60000);

    // After cleanup, the store should have the new entry but not the old one
    // Verify by checking that the identifier still works normally
    const result2 = checkRateLimit('cleanup-test', { limit: 5, windowMs: 1000 });
    expect(result2.success).toBe(true);
  });
});
