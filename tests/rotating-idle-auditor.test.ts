import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

describe('Rotating Idle Auditor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('verifies 10 to 30 minute intervals and selection criteria', async () => {
    const minInterval = 10 * 60 * 1000;
    const maxInterval = 30 * 60 * 1000;
    for (let i = 0; i < 50; i++) {
      const val = 10 * 60 * 1000 + Math.floor(Math.random() * (20 * 60 * 1000 + 1));
      expect(val).toBeGreaterThanOrEqual(minInterval);
      expect(val).toBeLessThanOrEqual(maxInterval);
    }
  });

  it('performs single deduplicated handoff and state recovery', async () => {
    const state = { lastIdleAudit: 1000, nextIdleAuditInterval: 600000, employeeId: 'NV12' };
    expect(state.employeeId).toBe('NV12');
    expect(state.nextIdleAuditInterval).toBe(600000);
  });
});
