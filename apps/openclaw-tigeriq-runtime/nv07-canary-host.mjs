import { nv07BootstrapCanaryDecision } from '../shared/nv07-canary-gate.mjs';
import { prepareNv07CliProposal, verifyNv07CliProposal } from '../shared/nv07-headless-proposal-adapter.mjs';

const denied = code => Object.freeze({ accepted: false, code, state: 'DENIED_NOT_RUN' });
const usable = f => typeof f === 'function';

// Importable, opt-in PC01 adapter; not installed, registered or auto-routed.
// Every authority receipt is read from a trusted host callback, never copied from a Job payload.
export async function runNv07OneShotCanary({ registry, commands, job, sandboxCwd, nowMs = Date.now() } = {}, host = {}) {
  if (!['readOwnerApproval', 'readCoreLease', 'attestSession', 'reserveOnce', 'runBoundedCli', 'storeReceipt']
    .every(name => usable(host[name]))) return denied('NV07_CANARY_HOST_CAPABILITIES_MISSING');
  try {
    const [approval, lease, session] = await Promise.all([
      host.readOwnerApproval({ workOrderId: 4783, jobId: job?.jobId }),
      host.readCoreLease({ resourceScope: job?.resourceScope, jobId: job?.jobId }),
      host.attestSession({ host: 'PC01', windowsUser: 'wdragons12x' }),
    ]);
    const gate = nv07BootstrapCanaryDecision({ registry, commands, session, job, lease, approval, nowMs });
    if (!gate.allowed) return denied(gate.code);
    const invocation = prepareNv07CliProposal(job, { sandboxCwd });
    if (!invocation.accepted) return denied(invocation.code);
    // Durable, atomic one-shot reservation prevents a duplicate execution under a reused job id.
    const reserved = await host.reserveOnce({ jobId: job.jobId, idempotencyKey: gate.idempotencyKey,
      sourceSha: gate.sourceSha, resourceScope: gate.resourceScope });
    if (reserved?.accepted !== true || reserved?.durable !== true
      || typeof reserved?.reservationSeq !== 'string' || !/^[1-9]\d{0,15}$/.test(reserved.reservationSeq))
      return denied('NV07_CANARY_ATOMIC_RESERVATION_REQUIRED');
    // Re-read Core immediately before invocation; do not trust a stale or caller-supplied lease.
    const freshLease = await host.readCoreLease({ resourceScope: gate.resourceScope, jobId: gate.jobId });
    const fresh = nv07BootstrapCanaryDecision({
      registry, commands, session, job, lease: freshLease, approval, nowMs: Date.now(),
    });
    if (!fresh.allowed) return denied('NV07_CANARY_LEASE_EXPIRED_BEFORE_RUN');
    // Host implements OS/AppLocker/process isolation, session identity, provenance, redaction and timeout.
    // This module never launches a shell, writes repository source or installs a runtime.
    const result = await host.runBoundedCli({
      command: invocation.command, args: [...invocation.args], cwd: invocation.cwd,
      timeoutMs: invocation.timeoutMs, maxOutputBytes: invocation.maxOutputBytes,
      jobId: gate.jobId, idempotencyKey: gate.idempotencyKey,
    });
    const verified = verifyNv07CliProposal({ job, invocation,
      exitCode: result?.exitCode, stdout: result?.stdout, stderr: result?.stderr,
      timedOut: result?.timedOut === true });
    if (!verified.accepted) return denied(verified.code);
    // Only persist non-secret, hash-based evidence. A canary does not activate/routably register NV07.
    const receipt = {
      workOrderId: 4783, jobId: gate.jobId, sourceSha: gate.sourceSha,
      idempotencyKey: gate.idempotencyKey, reservationSeq: reserved.reservationSeq,
      outputHash: verified.outputHash,
      proposedFileCount: verified.proposedFiles.length,
      state: 'BOOTSTRAP_CANARY_PROPOSAL_VERIFIED_NOT_ACTIVE',
    };
    const saved = await host.storeReceipt(receipt);
    const hasValidRef=typeof saved?.evidenceRef === 'string'
      && /^tigeriq_events:NV07_CANARY_RECEIPT:[1-9]\d{0,15}$/.test(saved.evidenceRef);
    const hasExternalUrl=typeof saved?.evidenceUrl === 'string'
      && /^https:\/\//.test(saved.evidenceUrl);
    if (saved?.durable !== true || (!hasValidRef && !hasExternalUrl))
      return denied('NV07_CANARY_DURABLE_RECEIPT_MISSING');
    return Object.freeze({ accepted: true, code: 'NV07_CANARY_RECEIPT_VERIFIED',
      state: 'BOOTSTRAP_CANARY_PROPOSAL_VERIFIED_NOT_ACTIVE',
      evidenceUrl: hasExternalUrl ? saved.evidenceUrl : null,
      evidenceRef: hasValidRef ? saved.evidenceRef : null,
      outputHash: verified.outputHash,
      jobId: gate.jobId, sourceSha: gate.sourceSha });
  } catch {
    // No repeated invocation or secret-bearing exception text. Never report DONE/ACTIVE.
    return denied('NV07_CANARY_HOST_ERROR');
  }
}
