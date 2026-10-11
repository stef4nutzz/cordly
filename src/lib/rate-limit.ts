import { env } from './env';

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const entries = new Map<string, RateLimitEntry>();

export function checkRateLimit(
  key: string,
  now = Date.now(),
  options?: { windowSeconds: number; maxRequests: number },
): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const windowMs = (options?.windowSeconds ?? env.RATE_LIMIT_WINDOW_SECONDS) * 1000;
  if (entries.size >= 5000 && !entries.has(key)) {
    for (const [entryKey, value] of entries) {
      if (value.resetAt <= now) entries.delete(entryKey);
    }
    while (entries.size >= 5000) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey === undefined) break;
      entries.delete(oldestKey);
    }
  }

  const current = entries.get(key);
  const entry =
    current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + windowMs };

  entry.count += 1;
  entries.set(key, entry);

  if (entry.count <= (options?.maxRequests ?? env.RATE_LIMIT_MAX_REQUESTS)) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}
