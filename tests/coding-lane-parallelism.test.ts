import { describe, expect, it } from 'vitest';
// @ts-expect-error TigerIQ Coding Lane is an ESM JavaScript module without a declaration file.\nimport { normalizeCodingParallelLimit } from '../apps/tigeriq-coding-lane/coding-lane.mjs';

describe('Coding Lane parallel execution cap', () => {
  it('defaults to the three slots exposed by Core', () => {
    expect(normalizeCodingParallelLimit()).toBe(3);
    expect(normalizeCodingParallelLimit(undefined)).toBe(3);
    expect(normalizeCodingParallelLimit('not-a-number')).toBe(3);
  });

  it('bounds configured concurrency to 1..3', () => {
    expect(normalizeCodingParallelLimit(0)).toBe(1);
    expect(normalizeCodingParallelLimit(1)).toBe(1);
    expect(normalizeCodingParallelLimit(2)).toBe(2);
    expect(normalizeCodingParallelLimit(3)).toBe(3);
    expect(normalizeCodingParallelLimit(9)).toBe(3);
  });
});
