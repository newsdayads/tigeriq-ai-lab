import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const core = readFileSync(new URL('../apps/tigeriq-core/mobile-worker-api.mjs', import.meta.url), 'utf8');
const client = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/ControllerClient.java', import.meta.url), 'utf8');
const service = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/ForegroundWorkerService.java', import.meta.url), 'utf8');
const taskStore = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/MobileTaskStore.java', import.meta.url), 'utf8');
const runStore = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/ChatGptB1RunStore.java', import.meta.url), 'utf8');

describe('Android Gate C Core-issued task contract', () => {
  it('keeps assignment and execution Core-issued only', () => {
    expect(core).toContain("url.pathname==='/api/mobile/tasks/enqueue'");
    expect(core).toContain("loopback_required");
    expect(core).toContain("url.pathname==='/api/mobile/tasks/lease'");
    expect(client).toContain('/api/mobile/tasks/lease');
    expect(service).toContain('client.pollLease()');
    expect(service).not.toMatch(/github|backlog|issues\/|pulls\//i);
  });

  it('persists one leased task and resumes the same run after restart', () => {
    expect(taskStore).toContain('tigeriq-mobile-task');
    expect(taskStore).toContain('taskId');
    expect(taskStore).toContain('leaseId');
    expect(taskStore).toContain('runId');
    expect(service).toContain('task.present()');
    expect(service).toContain('ChatGptB1RunStore.markRecovery');
    expect(service).toContain('client.renewLease');
    expect(runStore).toContain('startTask(Context context');
    expect(runStore).toContain('K_CUSTOM_PROMPT');
    expect(runStore).toContain('K_CUSTOM_EXPECTED_TOKEN');
  });

  it('reports a terminal result exactly once and rejects stale leases', () => {
    expect(core).toContain('mobileTaskTerminalDecision');
    expect(core).toContain('mobile_task_result_conflict');
    expect(core).toContain('mobile_lease_stale');
    expect(core).toContain("MOBILE_TASK_RESULT");
    expect(service).toContain('client.submitResult');
    expect(service).toContain('MobileTaskStore.markResultReported');
    expect(service).toContain('duplicateSendCount');
  });

  it('drains terminal evidence before clearing, claiming the next task, or updating', () => {
    const terminalBranch = service.indexOf('if (run.terminal())');
    const evidenceDrain = service.indexOf('reportPendingB1Evidence(client);', terminalBranch);
    const taskClear = service.indexOf('MobileTaskStore.clear(this);', terminalBranch);
    const pendingGuard = service.indexOf('if (run.terminal() && run.evidenceSeq > run.reportedSeq)');
    const nextLease = service.indexOf('JSONObject leased = client.pollLease();');
    expect(evidenceDrain).toBeGreaterThan(terminalBranch);
    expect(taskClear).toBeGreaterThan(evidenceDrain);
    expect(pendingGuard).toBeGreaterThan(taskClear);
    expect(nextLease).toBeGreaterThan(pendingGuard);
    expect(service).toContain('boolean evidencePending = run.terminal() && run.evidenceSeq > run.reportedSeq;');
  });
});
