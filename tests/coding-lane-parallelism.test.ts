import { describe, expect, it } from 'vitest';
// @ts-expect-error TigerIQ Coding Lane is an ESM JavaScript module without a declaration file.
import { normalizeCodingParallelLimit } from '../apps/tigeriq-coding-lane/coding-lane.mjs';

describe('Coding Lane parallel execution cap', () => {
  it('defaults to six bounded slots when enough providers exist', () => {
    expect(normalizeCodingParallelLimit()).toBe(6);
    expect(normalizeCodingParallelLimit(undefined)).toBe(6);
    expect(normalizeCodingParallelLimit('not-a-number')).toBe(6);
  });

  it('bounds configured concurrency to 1..6', () => {
    expect(normalizeCodingParallelLimit(0)).toBe(1);
    expect(normalizeCodingParallelLimit(1)).toBe(1);
    expect(normalizeCodingParallelLimit(2)).toBe(2);
    expect(normalizeCodingParallelLimit(3)).toBe(3);
    expect(normalizeCodingParallelLimit(4)).toBe(4);
    expect(normalizeCodingParallelLimit(6)).toBe(6);
    expect(normalizeCodingParallelLimit(9)).toBe(6);
  });
});
