import "server-only";
import { AppError } from "./errors";

/**
 * Bellek içi sabit pencere sınırlayıcı. Tek sunucu örneği için yeterlidir;
 * çok örnekli kurulumda Redis vb. ortak depoya taşınmalıdır (bkz. docs/LAUNCH_CHECKLIST.md).
 */
const g = globalThis as unknown as { __rl?: Map<string, { n: number; reset: number }> };
const buckets = (g.__rl ??= new Map());

export function rateLimit(key: string, max: number, windowSec: number) {
  if (process.env.RATE_LIMIT_DISABLED === "true") return;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowSec * 1000 });
    if (buckets.size > 50_000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    return;
  }
  if (++b.n > max) throw new AppError("rate_limited", 429);
}
