import { describe, expect, it } from 'vitest';
import { androidResourceEligibility, toAndroidWorkerNode } from '../packages/workforce/src/android-resource.js';
import type { TaskPacket } from '../packages/workforce/src/index.js';

const task = (requiredCapabilities: string[]): TaskPacket => ({
  taskId: 'TASK-ANDROID-1',
  idempotencyKey: 'android-1',
  objective: 'Run safe Android resource task',
  priority: 'P1',
  requiredCapabilities,
  constraints: ['zero-cost'],
  inputs: [],
  expectedArtifacts: ['json'],
  deadline: '2026-09-10T00:00:00.000Z',
  maxAttempts: 2,
  reviewPolicy: { independentReview: false, judgeRequired: false, preferProviderDiversity: false },
});

describe('Android resource contract', () => {
  it('registers an Android device as a worker node, not an employee identity', () => {
    const node = toAndroidWorkerNode({
      nodeId: 'NODE-S7',
      deviceId: 'DEV-S7',
      platform: 'android',
      agentVersion: '1.0.0',
      capabilities: ['http_api', 'local_inference', 'evidence'],
      lastHeartbeatAt: '2026-09-09T10:00:00.000Z',
      batteryPct: 80,
    });
    expect(node.kind).toBe('android');
    expect(node.deviceRef).toBe('DEV-S7');
    expect('employeeId' in node).toBe(false);
  });

  it('accepts only fresh nodes with every required capability', () => {
    const now = Date.parse('2026-09-09T10:00:30.000Z');
    const node = toAndroidWorkerNode({
      nodeId: 'NODE-S7',
      deviceId: 'DEV-S7',
      platform: 'android',
      agentVersion: '1.0.0',
      capabilities: ['http_api', 'evidence'],
      lastHeartbeatAt: '2026-09-09T10:00:00.000Z',
    });
    expect(androidResourceEligibility(node, task(['http_api']), now)).toEqual({ eligible: true, missingCapabilities: [] });
    expect(androidResourceEligibility(node, task(['http_api', 'filesystem']), now)).toEqual({
      eligible: false,
      reason: 'CAPABILITY_MISSING',
      missingCapabilities: ['filesystem'],
    });
  });

  it('fails closed for stale or offline Android resources', () => {
    const now = Date.parse('2026-09-09T10:01:00.000Z');
    const stale = toAndroidWorkerNode({
      nodeId: 'NODE-S7',
      deviceId: 'DEV-S7',
      platform: 'android',
      agentVersion: '1.0.0',
      capabilities: ['http_api'],
      lastHeartbeatAt: '2026-09-09T10:00:00.000Z',
    });
    expect(androidResourceEligibility(stale, task(['http_api']), now).reason).toBe('STALE');
    expect(androidResourceEligibility({ ...stale, status: 'offline' }, task(['http_api']), now).reason).toBe('OFFLINE');
  });
});
