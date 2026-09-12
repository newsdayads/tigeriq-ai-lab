import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  NV21Supervisor,
  runtimeState,
  checkCoreHealth,
  checkWebControlHealth,
  checkQueueHealth,
  dispatchWorkItem,
  updateWebControlStatus,
} from '../../packages/runtime/src/index';

vi.mock('../../packages/runtime/src/nv21-supervisor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/runtime/src/nv21-supervisor')>();
  return {
    ...actual,
    checkCoreHealth: vi.fn(),
    checkWebControlHealth: vi.fn(),
    checkQueueHealth: vi.fn(),
    dispatchWorkItem: vi.fn(),
    updateWebControlStatus: vi.fn(),
  };
});

describe('NV21Supervisor', () => {
  let currentTime = 1000000;
  const mockNow = () => currentTime;

  beforeEach(() => {
    vi.clearAllMocks();
    runtimeState.supervisor = {
      lastScan: 0,
      lastDeepScan: 0,
      activeIncidents: {},
      retryCounts: {},
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ensures no work item is created when all health checks pass', async () => {
    vi.mocked(checkCoreHealth).mockReturnValue({ healthy: true });
    vi.mocked(checkWebControlHealth).mockReturnValue({ healthy: true });
    vi.mocked(checkQueueHealth).mockReturnValue({ healthy: true });

    const supervisor = new NV21Supervisor(mockNow);
    await supervisor.audit(true);

    expect(dispatchWorkItem).not.toHaveBeenCalled();
    expect(runtimeState.supervisor.lastScan).toBe(currentTime);
    expect(runtimeState.supervisor.lastDeepScan).toBe(currentTime);
  });

  it('verifies that the supervisor creates a work item, respects deduplication, and respects the retry limit', async () => {
    vi.mocked(checkCoreHealth).mockReturnValue({ healthy: false, message: 'Core service failure' });
    vi.mocked(checkWebControlHealth).mockReturnValue({ healthy: true });
    vi.mocked(checkQueueHealth).mockReturnValue({ healthy: true });

    const supervisor = new NV21Supervisor(mockNow);

    // First audit: creates work item
    await supervisor.audit(false);
    expect(dispatchWorkItem).toHaveBeenCalledTimes(1);

    // Second audit (deduplication): should not create another work item for the same incident
    await supervisor.audit(false);
    expect(dispatchWorkItem).toHaveBeenCalledTimes(1);

    // Simulate subsequent audits for retry limits
    // Retry 2
    currentTime += 1000;
    // Clear incident map or force re-trigger to simulate multiple attempts if deduplicated
    // Actually, deduplication means the same active incident won't redispatch unless retried via circuit breaker logic.
    // Let's test retry exhaustion by resetting map or advancing attempts.
    const supervisor2 = new NV21Supervisor(mockNow);
    // Manually trigger audit 3 times total
    await supervisor2.audit(false); // attempt 1
    // To test max 3 retries, simulate new distinct failure or clear state and re-audit with same failure after count increments
    
    const state = runtimeState.supervisor;
    const keys = Object.keys(state.retryCounts);
    expect(keys.length).toBeGreaterThan(0);
    const key = keys[0];
    
    state.retryCounts[key].count = 3;
    await supervisor2.audit(false);
    
    expect(state.activeIncidents[key].status).toBe('BLOCKED_TECHNICAL');
  });
});
