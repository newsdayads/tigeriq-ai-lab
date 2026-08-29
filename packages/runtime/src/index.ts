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
