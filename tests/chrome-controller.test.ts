import { describe, it, expect, jest } from '@jest/globals';
import { buildRuntimeEvidence, freshAutopilotState } from '../../apps/chrome-controller/src/runtime-evidence.js';
import { AUTO_CONTINUE, freshSnapshot, freshAutopilotState as freshAutopilotState, decideAutoContinue, classifyAutoContinueDispatchFailure } from '../../apps/chrome-controller/src/autopilot.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const NOW = 1726339198000;
const OBSERVED_AT = NOW;
const baseConfig = () => ({
  workers: [{ id: 'NV02', type: 'NV02' }, { id: 'NV03', type: 'NV03' }, { id: 'NV04', type: 'NV04' }],
  workArea: { left: 0, top: 0, width: 4096, height: 2120 },
});

const snapshot = (nextJob?: any) => ({
  source: 'GITHUB',
  observedAt: new Date(OBSERVED_AT).toISOString(),
  revision: 'abc123',
  previousJob: { jobId: 'JOB-1', workerId: 'NV02', status: 'DONE', executable: true, priority: 'P0' },
  nextJob: nextJob || { jobId: 'JOB-2', workerId: 'NV02', status: 'READY', executable: true, priority: 'P0' },
});

const freshAutopilotState = () => ({
  phase: 'IDLE',
  lastDispatchedJobId: undefined,
  lastDispatchedAt: undefined,
  lastCompletedJobId: undefined,
  lastEvidenceRef: undefined,
  lastCompletedEvidenceRevision: undefined,
  lastTrigger: undefined,
  pendingJobId: undefined,
  pendingReservedAt: undefined,
  uncertainJobId: undefined,
  updatedAt: new Date(NOW).toISOString(),
});

describe('Dispatch lease and autopilot logic', () => {
  it('classifies NOT_DELIVERED outcomes as SAFE_RETRY', () => {
    expect(classifyAutoContinueDispatchFailure('SEND_BUTTON_NOT_FOUND', false)).toBe('SAFE_RETRY');
    expect(classifyAutoContinueDispatchFailure('UI_JOB_ACTIVE:', false)).toBe('SAFE_RETRY');
    expect(classifyAutoContinueDispatchFailure('unknown error', false)).toBe('UNCERTAIN');
  });

  it('exposes dispatchFailureClass and retryAt in runtime evidence', () => {
    const state = freshAutopilotState();
    state.dispatchFailureClass = 'UNCERTAIN';
    state.retryAt = NOW + 300000;
    const evidence = buildRuntimeEvidence(baseConfig(), baseConfig().workArea, [], [], state, snapshot(), true, false, {}, true, true, 'Console');
    expect(evidence.autopilot.dispatchFailureClass).toBe('UNCERTAIN');
    expect(evidence.autopilot.retryAt).toBe(state.retryAt);
  });

  it('releases leases immediately on SAFE_RETRY outcomes', () => {
    const decision = decideAutoContinue(
      snapshot({
        jobId: 'JOB-2',
        workerId: 'NV02',
        status: 'READY',
        executable: true,
        priority: 'P0',
        prompt: 'UI_JOB_ACTIVE:',
      }),
      freshAutopilotState(),
      NOW
    );
    expect(decision.kind).toBe('DISPATCH');
    expect(decision.dispatchFailureClass).toBe('SAFE_RETRY');
    expect(decision.retryAt).toBe(NOW);
  });

  it('holds uncertain leases for 5 minutes', () => {
    const decision = decideAutoContinue(
      snapshot({
        jobId: 'JOB-3',
        workerId: 'NV02',
        status: 'READY',
        executable: true,
        priority: 'P0',
      }),
      freshAutopilotState(),
      NOW
    );
    expect(decision.kind).toBe('DISPATCH');
    expect(decision.dispatchFailureClass).toBe('UNCERTAIN');
    expect(decision.retryAt).toBe(NOW + 5 * 60_000);
  });

  it('hardens ChatGPT submit detection in content scripts', () => {
    const content = readFileSync(resolve(__dirname, '../../apps/chrome-controller/extension/content.js'), 'utf8');
    expect(content).toContain('detectUiBusy');
    expect(content).toContain('TIGERIQ_UI_STATE');
  });
});

describe('completion-aware UTF-8 supervisor and Owner workspace', () => {
  it('reports UI generation state without parsing AI output', () => {
    const content = readFileSync(resolve(__dirname, '../../apps/chrome-controller/extension/content.js'), 'utf8');
    expect(content).toContain('detectUiBusy');
    expect(content).toContain('TIGERIQ_UI_STATE');
  });

  it('exposes dispatchFailureClass and retryAt in runtime evidence', () => {
    const state = freshAutopilotState();
    state.dispatchFailureClass = 'SAFE_RETRY';
    state.retryAt = NOW;
    const evidence = buildRuntimeEvidence(baseConfig(), baseConfig().workArea, [], [], state, snapshot(), true, false, {}, true, true, 'Console');
    expect(evidence.autopilot.dispatchFailureClass).toBe('SAFE_RETRY');
    expect(evidence.autopilot.retryAt).toBe(NOW);
  });
});

describe('SerialQueue', () => {
  it('runs exactly one task at a time', async () => {
    const q = new SerialQueue(0);
    const order: string[] = [];
    const a = q.enqueue(async () => {
      order.push('a:start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('a:end');
    });
    const b = q.enqueue(async () => {
      order.push('b:start');
      order.push('b:end');
    });
    await Promise.all([a, b]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });
});

export class SerialQueue {
  private queue: (() => Promise<void>)[] = [];
  private current: Promise<void> | null = null;
  constructor(private concurrency: number = 1) {}
  enqueue(task: () => Promise<void>): Promise<void> {
    if (this.current === null) {
      this.current = task();
      this.current.then(() => {
        this.current = null;
        this.flush();
      });
    } else {
      this.queue.push(task);
    }
    return Promise.resolve();
  }
  flush() {
    while (this.current === null && this.queue.length) {
      this.current = this.queue.shift()!();
      this.current.then(() => {
        this.current = null;
        this.flush();
      });
    }
  }
}
