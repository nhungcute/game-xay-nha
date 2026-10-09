/** Fixed-window in-memory limiter (single API instance in MVP; docs/11 §4.2, docs/08 §5). */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly clock: () => number = Date.now) {}

  /** Returns true when allowed and counts `cost` units. */
  take(key: string, cost = 1): boolean {
    const now = this.clock(), w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: cost });
      this.gc(now);
      return cost <= this.limit;
    }
    if (w.count + cost > this.limit) return false;
    w.count += cost;
    return true;
  }

  private gc(now: number): void {
    if (this.windows.size < 10_000) return;
    for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
  }
}
