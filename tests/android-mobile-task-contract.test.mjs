import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const core = readFileSync(new URL('../apps/tigeriq-core/mobile-worker-api.mjs', import.meta.url), 'utf8');
const coreMain = readFileSync(new URL('../apps/tigeriq-core/core.mjs', import.meta.url), 'utf8');
const client = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/ControllerClient.java', import.meta.url), 'utf8');
const service = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/ForegroundWorkerService.java', import.meta.url), 'utf8');
const taskStore = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/MobileTaskStore.java', import.meta.url), 'utf8');
const runStore = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/ChatGptB1RunStore.java', import.meta.url), 'utf8');
const updateEngine = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/WorkerUpdateEngine.java', import.meta.url), 'utf8');

describe('Android Gate C Core-issued task contract', () => {
  it('keeps assignment and execution Core-issued only', () => {
    expect(core).toContain("url.pathname==='/api/mobile/tasks/enqueue'");
    expect(core).toContain("loopback_required");
    expect(core).toContain("core_auth_required");
    expect(core).toContain("verifyCoreEnqueueAuth(req,coreAuthToken)");
    expect(coreMain).toContain("createMobileWorkerApi({pool,event,coreAuthToken:TOKEN})");
    expect(core).toContain("url.pathname==='/api/mobile/tasks/lease'");
    expect(client).toContain('/api/mobile/tasks/lease');
    expect(service).toContain('client.pollLease()');
    expect(service).not.toMatch(/github|backlog|issues\/|pulls\//i);
  });

  it('defers a persisted Core task while a manual B1 run owns ChatGPT', () => {
    expect(service).toContain('boolean sameTaskRun = task.taskId.equals(run.taskId) && task.runId.equals(run.runId);');
    expect(service).toContain('if (run.active() && !sameTaskRun)');
    expect(service).toContain('if (run.terminal() && !sameTaskRun)');
    expect(service).toContain('if (sameTaskRun && run.terminal())');
    const manualGuard = service.indexOf('if (run.active() && !sameTaskRun)');
    const recoveryLaunch = service.indexOf('ChatGptB1RunStore.markRecovery(this);', manualGuard);
    expect(manualGuard).toBeGreaterThan(-1);
    expect(recoveryLaunch).toBeGreaterThan(manualGuard);
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

  it('checks exact lease freshness before terminal idempotency', () => {
    const leaseGuard = core.indexOf('if(!mobileTaskLeaseFresh({currentLeaseId:task.lease_id,leaseId,leaseExpiresAt:task.lease_expires_at}))');
    const terminalDecision = core.indexOf('const decision=mobileTaskTerminalDecision({status:task.status', leaseGuard);
    const idempotentAccept = core.indexOf('if(decision.idempotent)', terminalDecision);
    expect(leaseGuard).toBeGreaterThan(-1);
    expect(terminalDecision).toBeGreaterThan(leaseGuard);
    expect(idempotentAccept).toBeGreaterThan(terminalDecision);
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

  it('fails closed on every update path while Core task or evidence is pending', () => {
    const taskGuard = updateEngine.indexOf('if (task.present())');
    const b1Guard = updateEngine.indexOf('if (run.active())');
    const evidenceGuard = updateEngine.indexOf('if (run.terminal() && run.evidenceSeq > run.reportedSeq)');
    const manifestFetch = updateEngine.indexOf('JSONObject manifest = client.updateManifest()');
    expect(taskGuard).toBeGreaterThan(-1);
    expect(b1Guard).toBeGreaterThan(taskGuard);
    expect(evidenceGuard).toBeGreaterThan(b1Guard);
    expect(manifestFetch).toBeGreaterThan(evidenceGuard);
    expect(updateEngine).toContain('"DEFERRED_CORE_TASK"');
    expect(updateEngine).toContain('"DEFERRED_EVIDENCE_PENDING"');
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
