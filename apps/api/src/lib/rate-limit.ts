import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { AuthedEnv } from '../types.ts';

/**
 * Per-user sliding-window limiter (in memory; fine for a single API process).
 * Create one per route group so limits are independent.
 */
export function rateLimitPerUser({ max, windowMs }: { max: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  return createMiddleware<AuthedEnv>(async (c, next) => {
    const key = c.get('user').id;
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - (recent[0] ?? now))) / 1000);
      c.header('Retry-After', String(retryAfter));
      throw new HTTPException(429, {
        message: `Too many requests. Try again in ${Math.ceil(retryAfter / 60)} min.`,
      });
    }
    recent.push(now);
    hits.set(key, recent);
    await next();
  });
}
