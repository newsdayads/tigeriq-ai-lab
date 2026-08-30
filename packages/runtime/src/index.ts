export class ConcurrencyLimiter {
  #active = 0;
  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('concurrency limit must be a positive integer');
  }
  acquire(): boolean {
    if (this.#active >= this.limit) return false;
    this.#active += 1;
    return true;
  }
  release(): void {
    if (this.#active < 1) throw new Error('concurrency limiter underflow');
    this.#active -= 1;
  }
  get active(): number { return this.#active; }
}

export class ApiMetrics {
  #completed = 0;
  #rejected = 0;
  #durationMs = 0;
  readonly #statuses = new Map<number, number>();

  observe(status: number, durationMs: number): void {
    this.#completed += 1;
    this.#durationMs += durationMs;
    this.#statuses.set(status, (this.#statuses.get(status) ?? 0) + 1);
  }
  reject(): void { this.#rejected += 1; }
  snapshot(active: number) {
    return Object.freeze({
      requestsCompleted: this.#completed,
      requestsRejectedOverload: this.#rejected,
      activeRequests: active,
      averageDurationMs: this.#completed === 0 ? 0 : Math.round((this.#durationMs / this.#completed) * 100) / 100,
      statuses: Object.fromEntries([...this.#statuses].map(([status, count]) => [String(status), count])),
    });
  }
}

export interface RateLimitDecision { allowed: boolean; remaining: number; retryAfterMs: number; }

export class FixedWindowRateLimiter {
  readonly #buckets = new Map<string, { start: number; count: number }>();
  constructor(readonly limit: number, readonly windowMs: number, readonly now: () => number = Date.now) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('rate limit must be a positive integer');
    if (!Number.isFinite(windowMs) || windowMs < 1) throw new Error('rate window must be positive');
  }
  consume(identity: string): RateLimitDecision {
    const current = this.now();
    let bucket = this.#buckets.get(identity);
    if (!bucket || current - bucket.start >= this.windowMs) {
      bucket = { start: current, count: 0 };
      this.#buckets.set(identity, bucket);
    }
    if (bucket.count >= this.limit) {
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(1, bucket.start + this.windowMs - current) };
    }
    bucket.count += 1;
    return { allowed: true, remaining: this.limit - bucket.count, retryAfterMs: 0 };
  }
}
