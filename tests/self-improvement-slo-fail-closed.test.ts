import { describe, expect, it } from 'vitest';
import { assessPerformance } from '../packages/self-improvement/src/index.js';

describe('Self-improvement SLO fail-closed evidence', () => {
  it('fails when a configured budget has no corresponding measurement', () => {
    const result = assessPerformance({}, {
      max_startup_to_action_ms: 2500,
      min_cache_hit_ratio: 0.7,
    });
    expect(result.pass).toBe(false);
    expect(result.violations).toEqual([
      'startup_to_action_ms:MISSING',
      'cache_hit_ratio:MISSING',
    ]);
  });

  it('fails on non-finite measurements or budget values', () => {
    const result = assessPerformance({ source_fetches: Number.NaN }, { max_source_fetches: Number.POSITIVE_INFINITY });
    expect(result.pass).toBe(false);
    expect(result.violations).toEqual(['source_fetches:BUDGET_INVALID']);
  });
});
