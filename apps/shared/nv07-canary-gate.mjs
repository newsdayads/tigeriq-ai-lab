import { nv07ProposalPreflight } from './nv07-proposal-preflight.mjs';

export const NV07_BOOTSTRAP_CANARY_SCOPE = 'TIGERIQ_NV07_PC01_READ_ONLY_CANARY_4783';
const blocked = code => Object.freeze({ allowed: false, code, state: 'DENIED' });
const validTime = value => typeof value === 'string' ? Date.parse(value) : NaN;

export function nv07BootstrapCanaryDecision({ registry, commands, session, job, lease, approval, nowMs = Date.now() } = {}) {
  // This path is exclusively for one authenticated Owner-authorized bootstrap canary;
  // it MUST NOT call the normal production routing decision or activate NV07.
  if (!registry || registry.employee_id !== 'NV07' || registry.name !== 'Google Antigravity')
    return blocked('NV07_CANARY_WRONG_EMPLOYEE');
  const state = String(registry.admin_state || '').toUpperCase();
  const v58='ACTIVE_CORE_RESOURCE / P1_P5_PROPOSAL_ONLY / ACCEPTED_S6_S7_PASS / PC01_ANTIGRAVITY';
  // V58 historical acceptance may admit this *one-shot* bootstrap only.
  // It does not grant runtime heartbeat or ordinary P1-P5 dispatch.
  if (/RETIRED|DISABLED|OWNER_STOPPED/.test(state) ||
      (!state.includes('PROVISIONING') && state.trim()!==v58))
    return blocked('NV07_CANARY_NOT_PROVISIONING');
  if (commands?.['7'] !== 'NV07') return blocked('NV07_CANARY_COMMAND_UNVERIFIED');
  if (session?.attestationVerified !== true || session?.host !== 'PC01'
      || session?.windowsUser !== 'wdragons12x' || session?.deviceIdentityVerified !== true)
    return blocked('NV07_CANARY_SESSION_NOT_VERIFIED');
  if (job?.resourceScope !== NV07_BOOTSTRAP_CANARY_SCOPE || job?.action !== 'READ_METADATA')
    return blocked('NV07_CANARY_ACTION_OR_SCOPE_DENIED');
  const preflight = nv07ProposalPreflight(job);
  if (!preflight.allowed) return blocked(preflight.code);
  if (!approval || approval.verifiedByTrustedHost !== true || approval.workOrderId !== 4783
      || approval.resourceScope !== NV07_BOOTSTRAP_CANARY_SCOPE
      || approval.jobId !== job.jobId || approval.sourceSha !== job.sourceSha
      || approval.action !== 'READ_METADATA'
      || typeof approval.idempotencyKey !== 'string' || approval.idempotencyKey.length < 16
      || approval.idempotencyKey.length > 128)
    return blocked('NV07_CANARY_OWNER_AUTH_NOT_VERIFIED');
  const issued = validTime(approval.issuedAt), expires = validTime(approval.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > nowMs
      || expires <= nowMs || expires - issued > 10 * 60 * 1000)
    return blocked('NV07_CANARY_OWNER_AUTH_EXPIRED');
  if (!lease || lease.verifiedByCore !== true || lease.job_id !== job.jobId
      || lease.employee_id !== 'NV07' || lease.resource_scope !== NV07_BOOTSTRAP_CANARY_SCOPE
      || lease.state !== 'ACTIVE' || lease.idempotency_key !== approval.idempotencyKey
      || !Number.isFinite(validTime(lease.expires_at)) || validTime(lease.expires_at) <= nowMs)
    return blocked('NV07_CANARY_CORE_LEASE_INVALID');
  return Object.freeze({
    allowed: true,
    code: 'NV07_BOOTSTRAP_CANARY_ADMITTED',
    state: 'ONE_SHOT_READ_ONLY_CANARY_NOT_ROUTABLE',
    jobId: job.jobId,
    sourceSha: job.sourceSha,
    idempotencyKey: approval.idempotencyKey,
    resourceScope: NV07_BOOTSTRAP_CANARY_SCOPE,
  });
}
