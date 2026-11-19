// Counts FAILED logins per key (IP, and IP+email). Blocks after maxFailures inside windowMs.
export interface LoginLimiterOptions { maxFailures: number; windowMs: number; now?: () => number; }

export function createLoginLimiter({ maxFailures, windowMs, now = Date.now }: LoginLimiterOptions) {
  const store = new Map<string, { count: number; resetAt: number }>();
  const live = (key: string) => {
    const e = store.get(key);
    if (e && e.resetAt <= now()) { store.delete(key); return undefined; }
    return e;
  };
  return {
    check(key: string): { allowed: boolean; retryAfterSec: number } {
      const e = live(key);
      if (e && e.count >= maxFailures) return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((e.resetAt - now()) / 1000)) };
      return { allowed: true, retryAfterSec: 0 };
    },
    fail(key: string) {
      const e = live(key);
      if (e) e.count++; else store.set(key, { count: 1, resetAt: now() + windowMs });
      if (store.size > 50_000) { const t = now(); for (const [k, v] of store) if (v.resetAt <= t) store.delete(k); }
    },
    success(key: string) { store.delete(key); },
  };
}
