import { describe, expect, it, vi } from 'vitest';
import { nv07BootstrapCanaryDecision, NV07_BOOTSTRAP_CANARY_SCOPE as SCOPE } from '../apps/shared/nv07-canary-gate.mjs';
import { runNv07OneShotCanary } from '../apps/openclaw-tigeriq-runtime/nv07-canary-host.mjs';

const NOW = Date.now();
const iso = ms => new Date(ms).toISOString();
const job = () => ({
  employeeId: 'NV07', executionHost: 'PC01', repository: 'newsdayads/tigeriq-ai-lab',
  priority: 'P2', action: 'READ_METADATA', jobId: 'NV07-4783-CANARY',
  sourceSha: 'a'.repeat(40), paths: ['docs/implementation/nv07-proposal.md'],
  resourceScope: SCOPE,
});
const registry = () => ({ employee_id: 'NV07', name: 'Google Antigravity',
  admin_state: 'ADMIN_ENABLED / PROVISIONING / RUNTIME_NOT_VERIFIED / NOT_YET_ROUTABLE' });
const commands = { '7': 'NV07' };
const session = () => ({ host: 'PC01', windowsUser: 'wdragons12x',
  attestationVerified: true, deviceIdentityVerified: true });
const approval = (j = job()) => ({
  verifiedByTrustedHost: true, workOrderId: 4783, resourceScope: SCOPE,
  jobId: j.jobId, sourceSha: j.sourceSha, action: 'READ_METADATA',
  idempotencyKey: 'nv07-canary-owner-4783-once', issuedAt: iso(NOW - 1000),
  expiresAt: iso(NOW + 5 * 60 * 1000),
});
const lease = (j = job()) => ({ verifiedByCore: true, job_id: j.jobId,
  employee_id: 'NV07', resource_scope: SCOPE, state: 'ACTIVE',
  idempotency_key: 'nv07-canary-owner-4783-once', expires_at: iso(NOW + 5 * 60 * 1000) });
const evidence = j => ({ status: 'SUCCESS', structured_output: {
  job_id: j.jobId, summary: 'Read-only proposal canary', proposed_files: [{
    path: j.paths[0], change: 'No source change applied', rationale: 'Smoke only',
  }], risks: ['Requires independent GitHub implementation'],
}});
const sandboxCwd = 'C:\\Users\\wdragons12x\\AppData\\Local\\TigerIQ\\NV07\\proposal-sandbox';
const args = () => ({ registry: registry(), commands, job: job(), sandboxCwd, nowMs: NOW });
const host = (j = job()) => ({
  readOwnerApproval: vi.fn(async () => approval(j)),
  readCoreLease: vi.fn(async () => lease(j)),
  attestSession: vi.fn(async () => session()),
  reserveOnce: vi.fn(async () => ({ accepted: true, durable: true })),
  runBoundedCli: vi.fn(async () => ({ exitCode: 0, stdout: JSON.stringify(evidence(j)), stderr: '', timedOut: false })),
  storeReceipt: vi.fn(async () => ({ durable: true, evidenceUrl: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/4783' })),
});
describe('NV07 bootstrap canary: one-shot, read-only, never ACTIVE', () => {
  it('admits provisioning only for a signed/verified exact owner, Core lease and Windows session', () => {
    expect(nv07BootstrapCanaryDecision({ registry: registry(), commands, session: session(),
      job: job(), approval: approval(), lease: lease(), nowMs: NOW })).toMatchObject({
      allowed: true, state: 'ONE_SHOT_READ_ONLY_CANARY_NOT_ROUTABLE',
    });
  });
  it.each([
    ['no owner proof', x => x.approval.verifiedByTrustedHost = false],
    ['wrong owner work', x => x.approval.workOrderId = 1111],
    ['expired owner proof', x => x.approval.expiresAt = iso(NOW-1)],
    ['wrong user', x => x.session.windowsUser = 'SYSTEM'],
    ['forged device', x => x.session.deviceIdentityVerified = false],
    ['no verified Core lease', x => x.lease.verifiedByCore = false],
    ['lease expired', x => x.lease.expires_at = iso(NOW-1)],
    ['wrong idempotency', x => x.lease.idempotency_key = 'other'],
    ['wrong command', x => x.commands = {'7':'NV03'}],
    ['wrong employee', x => x.registry.name = 'ChatGPT Go'],
    ['already ACTIVE', x => x.registry.admin_state = 'ACTIVE'],
    ['retired', x => x.registry.admin_state = 'RETIRED / PROVISIONING'],
    ['P0', x => x.job.priority = 'P0'],
    ['source write', x => x.job.action = 'WRITE_SOURCE'],
    ['App Chrome', x => x.job.paths = ['apps/chrome-controller/src/server.ts']],
    ['missing source pin', x => x.job.sourceSha = 'latest'],
  ])('denies %s', (_name, mutate) => {
    const x = { registry:registry(), commands:{...commands}, session:session(),
      job:job(), approval:approval(), lease:lease(), nowMs:NOW };
    mutate(x);
    expect(nv07BootstrapCanaryDecision(x).allowed).toBe(false);
  });
  it('does not invoke CLI when capabilities are missing', async () => {
    expect(await runNv07OneShotCanary(args(), {})).toMatchObject({
      accepted: false, code: 'NV07_CANARY_HOST_CAPABILITIES_MISSING',
    });
  });
  it('returns a non-ACTIVE receipt and runs once only after reservation', async () => {
    const h=host(); const got=await runNv07OneShotCanary(args(),h);
    expect(got).toMatchObject({ accepted:true, state:'BOOTSTRAP_CANARY_PROPOSAL_VERIFIED_NOT_ACTIVE' });
    expect(h.reserveOnce).toHaveBeenCalledTimes(1);
    expect(h.readCoreLease).toHaveBeenCalledTimes(2);
    expect(h.runBoundedCli).toHaveBeenCalledTimes(1);
    expect(h.runBoundedCli.mock.calls[0][0].command).toBe('agy');
    expect(h.storeReceipt).toHaveBeenCalledWith(expect.objectContaining({
      workOrderId:4783, state:'BOOTSTRAP_CANARY_PROPOSAL_VERIFIED_NOT_ACTIVE',
    }));
  });
  it('rejects duplicates, invalid CLI JSON, and missing durable evidence', async () => {
    const dup=host();dup.reserveOnce.mockResolvedValue({accepted:false,durable:true});
    expect((await runNv07OneShotCanary(args(),dup)).accepted).toBe(false);
    expect(dup.runBoundedCli).not.toHaveBeenCalled();
    const invalid=host();invalid.runBoundedCli.mockResolvedValue({exitCode:0,stdout:'{}',stderr:''});
    expect((await runNv07OneShotCanary(args(),invalid)).accepted).toBe(false);
    const missing=host();missing.storeReceipt.mockResolvedValue({durable:false});
    expect((await runNv07OneShotCanary(args(),missing)).accepted).toBe(false);
  });
  it('denies quota/auth and runtime exceptions without leaking command output', async () => {
    const auth=host();auth.readOwnerApproval.mockResolvedValue(null);
    expect((await runNv07OneShotCanary(args(),auth)).accepted).toBe(false);
    expect(auth.runBoundedCli).not.toHaveBeenCalled();
    const fail=host();fail.runBoundedCli.mockRejectedValue(new Error('SECRET_EXAMPLE'));
    expect(await runNv07OneShotCanary(args(),fail)).toMatchObject({
      accepted:false,code:'NV07_CANARY_HOST_ERROR',
    });
  });
});
