/**
 * Simple in-memory rate limiter for API routes.
 *
 * Note: This uses in-memory storage, so it won't work across multiple
 * server instances in production. For production deployments, consider
 * using a distributed store like Redis with @upstash/ratelimit.
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 60000);

export interface RateLimitConfig {
  /** Maximum requests per window */
  limit: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
}

/**
 * Check if a request should be rate limited.
 * Uses X-Forwarded-For or falls back to a default identifier.
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  if (!entry || now > entry.resetTime) {
    // New window
    rateLimitStore.set(identifier, {
      count: 1,
      resetTime: now + config.windowMs,
    });
    return {
      success: true,
      limit: config.limit,
      remaining: config.limit - 1,
      resetTime: now + config.windowMs,
    };
  }

  if (entry.count >= config.limit) {
    // Limit exceeded
    return {
      success: false,
      limit: config.limit,
      remaining: 0,
      resetTime: entry.resetTime,
    };
  }

  // Increment count
  entry.count++;
  return {
    success: true,
    limit: config.limit,
    remaining: config.limit - entry.count,
    resetTime: entry.resetTime,
  };
}

/**
 * Extract client identifier from request headers.
 * Falls back to 'unknown' if no identifier can be found.
 */
export function getClientIdentifier(request: Request): string {
  // Try X-Forwarded-For header (set by proxies/load balancers)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    // Take the first IP (original client)
    return forwarded.split(',')[0].trim();
  }

  // Try X-Real-IP header (set by some proxies)
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Fallback - in development this is fine, in production you'd want better identification
  return 'unknown';
}

/** Default rate limit config for LLM endpoints (20 requests per minute) */
export const LLM_RATE_LIMIT: RateLimitConfig = {
  limit: 20,
  windowMs: 60 * 1000, // 1 minute
};

/** Stricter rate limit for expensive operations (10 requests per minute) */
export const STRICT_RATE_LIMIT: RateLimitConfig = {
  limit: 10,
  windowMs: 60 * 1000, // 1 minute
}
