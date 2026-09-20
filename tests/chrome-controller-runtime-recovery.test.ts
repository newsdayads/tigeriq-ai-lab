import { describe, it, expect } from 'node:test';
import { watchModelProfileBlockedState, type EvidenceWorkerState } from '../apps/chrome-controller/src/runtime-evidence.js';
import { restoreGpt5_6SolProfile } from '../apps/chrome-controller/src/model.js';
import { handleRuntimeProfileRecovery } from '../apps/chrome-controller/src/security-gate.js';

describe('Chrome Controller Runtime Recovery for NV02 Model Profile', () => {
  it('watches and detects MODEL_PROFILE_BLOCKED state', () => {
    const worker: EvidenceWorkerState = {
      id: 'NV02',
      enabled: true,
      status: 'RUNNING',
      blocked: true,
      lastHeartbeat: {
        at: new Date().toISOString(),
        modelProfileStatus: 'MODEL_PROFILE_BLOCKED',
        modelName: 'GPT-4',
      },
      blockedReason: 'MODEL_PROFILE_BLOCKED',
    };
    expect(watchModelProfileBlockedState(worker)).toBe(true);
  });

  it('simulates controlled interruption, forces blocked state, and runs recovery controller loop', () => {
    const workItemId = 'job-nv02-test-999';
    const worker: EvidenceWorkerState = {
      id: 'NV02',
      enabled: true,
      status: 'RUNNING',
      blocked: true,
      lastHeartbeat: {
        at: new Date().toISOString(),
        modelName: 'MODEL_NAME_NOT_GPT_5_6_SOL',
      },
    };

    // Verify watcher detects it
    expect(watchModelProfileBlockedState(worker)).toBe(true);

    // Run recovery handler first time
    const firstRun = handleRuntimeProfileRecovery(worker, workItemId, 1);
    expect(firstRun.recovered).toBe(true);
    expect(firstRun.workItemId).toBe(workItemId);

    // Verify restore function was called and payload contained original WorkItem ID
    const directRestore = restoreGpt5_6SolProfile(workItemId);
    expect(directRestore.dispatched).toBe(false); // Idempotent check
    expect(directRestore.workItemId).toBe(workItemId);
    expect(directRestore.modelProfile).toBe('GPT-5.6 Sol');
    expect(directRestore.reasoningEffort).toBe('High');

    // Verify duplicate dispatches are prevented for same reopen epoch
    const duplicateRun = handleRuntimeProfileRecovery(worker, workItemId, 1);
    expect(duplicateRun.recovered).toBe(false);
    expect(duplicateRun.error).toBe('ALREADY_RESTORED_FOR_REOPEN');
  });
});
