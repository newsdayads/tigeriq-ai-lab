import { describe, expect, it } from 'vitest';
import { ApiMetrics, ConcurrencyLimiter, FixedWindowRateLimiter } from '../packages/runtime/src/index.js';

describe('runtime safeguards', () => {
  it('fails closed when concurrency capacity is exhausted', () => {
    const limiter = new ConcurrencyLimiter(1);
    expect(limiter.acquire()).toBe(true);
    expect(limiter.acquire()).toBe(false);
    expect(limiter.active).toBe(1);
    limiter.release();
    expect(limiter.acquire()).toBe(true);
  });

  it('reports bounded aggregate metrics without request content', () => {
    const metrics = new ApiMetrics();
    metrics.observe(200, 10);
    metrics.observe(503, 30);
    metrics.reject();
    expect(metrics.snapshot(1)).toEqual({
      requestsCompleted: 2, requestsRejectedOverload: 1, activeRequests: 1,
      averageDurationMs: 20, statuses: { '200': 1, '503': 1 },
    });
  });

  it('isolates actor quotas and resets after the fixed window', () => {
    let now = 1000;
    const limiter = new FixedWindowRateLimiter(2, 100, () => now);
    expect(limiter.consume('actor-a')).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.consume('actor-a')).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.consume('actor-a')).toMatchObject({ allowed: false, retryAfterMs: 100 });
    expect(limiter.consume('actor-b').allowed).toBe(true);
    now += 100;
    expect(limiter.consume('actor-a').allowed).toBe(true);
  });
});
