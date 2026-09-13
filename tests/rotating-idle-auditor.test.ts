import { jest } from '@jest/globals';
import { CADENCE_LIGHT_MS, CADENCE_DEEP_MS, shouldRun, dedupKey } from '../apps/tigeriq-core/core.mjs';

describe('Self‑check cadence helpers', () => {
  beforeAll(() => jest.useFakeTimers());
  afterAll(() => jest.useRealTimers());

  test('light cadence triggers after 10m boundary', () => {
    const start = 0;
    expect(shouldRun(start, CADENCE_LIGHT_MS - 1, CADENCE_LIGHT_MS)).toBe(false);
    expect(shouldRun(start, CADENCE_LIGHT_MS, CADENCE_LIGHT_MS)).toBe(true);
  });

  test('deep cadence triggers after 30m boundary', () => {
    const start = 0;
    expect(shouldRun(start, CADENCE_DEEP_MS - 1, CADENCE_DEEP_MS)).toBe(false);
    expect(shouldRun(start, CADENCE_DEEP_MS, CADENCE_DEEP_MS)).toBe(true);
  });

  test('restart persistence simulated via stored timestamps', () => {
    const lastRun = 5 * 60 * 1000; // 5 minutes ago
    const now = 15 * 60 * 1000; // 15 minutes total
    // Light should run because 10m passed since lastRun
    expect(shouldRun(lastRun, now, CADENCE_LIGHT_MS)).toBe(true);
    // Deep should not run because only 10m passed
    expect(shouldRun(lastRun, now, CADENCE_DEEP_MS)).toBe(false);
  });

  test('dedupKey produces stable bucketed keys', () => {
    const now = 1234567890000; // arbitrary timestamp
    const key1 = dedupKey('HANDOFF_DEEP', now, CADENCE_DEEP_MS);
    const key2 = dedupKey('HANDOFF_DEEP', now + CADENCE_DEEP_MS - 1, CADENCE_DEEP_MS);
    const key3 = dedupKey('HANDOFF_DEEP', now + CADENCE_DEEP_MS, CADENCE_DEEP_MS);
    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });
});
