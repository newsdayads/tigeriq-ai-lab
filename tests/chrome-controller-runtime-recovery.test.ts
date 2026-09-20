import { describe, it, expect, beforeEach } from 'vitest';
import { checkModelProfileBlockedAfterReopen } from '../apps/chrome-controller/src/runtime-evidence.js';
import { restoreGpt5_6SolProfile } from '../apps/chrome-controller/src/model.js';
import { checkAndRestoreModelProfileAfterReopen, resetRuntimeRecoveryGuards } from '../apps/chrome-controller/src/security-gate.js';

describe('Chrome Controller Runtime Recovery', () => {
  beforeEach(() => {
    resetRuntimeRecoveryGuards();
  });

  it('simulates controlled interruption, forces blocked state, and verifies recovery exactly once', () => {
    const worker = {
      id: 'NV02' as const,
      enabled: true,
      status: 'RUNNING',
      blocked: true,
      windowState: 'OPEN' as const,
      lastHeartbeat: {
        at: new Date().toISOString(),
        blockedReason: 'MODEL_PROFILE_BLOCKED',
        modelProfileStatus: 'BLOCKED',
        modelName: 'NOT_GPT_5_6_SOL',
      },
    };

    const originalWorkItemId = 'JOB-WORK-ITEM-999';
    const dispatches: any[] = [];
    const mockDispatchBridge = (payload: any) => {
      dispatches.push(payload);
      return true;
    };

    // Verify detection helper
    const isBlocked = checkModelProfileBlockedAfterReopen(worker);
    expect(isBlocked).toBe(true);

    // Run controller loop recovery invocation (First call)
    const firstAttempt = checkAndRestoreModelProfileAfterReopen(worker, originalWorkItemId, mockDispatchBridge);
    expect(firstAttempt.restored).toBe(true);

    // Assert dispatch payload contains original WorkItem ID and correct profile
    expect(dispatches.length).toBe(1);
    expect(dispatches[0].workItemId).toBe(originalWorkItemId);
    expect(dispatches[0].workerId).toBe('NV02');
    expect(dispatches[0].profile).toBe('GPT-5.6 Sol');
    expect(dispatches[0].reasoningEffort).toBe('High');

    // Run controller loop recovery invocation again (Second call - duplicate attempt)
    const secondAttempt = checkAndRestoreModelProfileAfterReopen(worker, originalWorkItemId, mockDispatchBridge);
    expect(secondAttempt.restored).toBe(false);
    expect(secondAttempt.reason).toBe('ALREADY_RESTORED_FOR_REOPEN');

    // Assert no duplicate dispatches emitted
    expect(dispatches.length).toBe(1);
  });
});
