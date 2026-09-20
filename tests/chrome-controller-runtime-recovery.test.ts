import { describe, it, expect, vi } from 'vitest';
import { restoreGpt5_6SolProfile } from '../apps/chrome-controller/src/model';
import { watchAndRestoreModelProfile } from '../apps/chrome-controller/src/runtime-evidence';
import { checkAndHandleModelProfileRecovery } from '../apps/chrome-controller/src/security-gate';

import { clearRestoredReopenFlags } from '../apps/chrome-controller/src/runtime-evidence';

describe('Chrome Controller Runtime Recovery', () => {
  it('simulates controlled interruption, forces blocked state, and verifies exactly-once restore dispatch with original workItem ID', () => {
    clearRestoredReopenFlags();
    const dispatchMock = vi.fn();
    const workerId = 'NV02';
    const workItemId = 'WORK-ITEM-123';

    const hbBlocked = {
      at: new Date().toISOString(),
      modelProfileStatus: 'MODEL_PROFILE_BLOCKED',
      modelName: 'MODEL_NAME_NOT_GPT_5_6_SOL',
    };

    // First invocation should trigger dispatch once
    const recovered1 = watchAndRestoreModelProfile(workerId, hbBlocked, workItemId, dispatchMock);
    expect(recovered1).toBe(true);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith({ 
      modelProfile: 'GPT-5.6 Sol', 
      reasoningEffort: 'High',
      workItemId: 'WORK-ITEM-123'
    });

    // Second invocation should not trigger duplicate dispatch due to once-per-reopen guard
    const recovered2 = watchAndRestoreModelProfile(workerId, hbBlocked, workItemId, dispatchMock);
    expect(recovered2).toBe(false);
    expect(dispatchMock).toHaveBeenCalledTimes(1);

    // Test security gate wrapper with a different worker or work item to verify gate invocation
    clearRestoredReopenFlags();
    const recoveredGate = checkAndHandleModelProfileRecovery(workerId, hbBlocked, 'WORK-ITEM-456', dispatchMock);
    expect(recoveredGate).toBe(true);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });
});
