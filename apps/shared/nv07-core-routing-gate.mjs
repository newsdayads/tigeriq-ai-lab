import { nv07ProposalPreflight } from './nv07-proposal-preflight.mjs';

// Pure decision helper: authoritative Core must independently verify signed/atomic lease
// and call the approved local adapter. This module does not dispatch or activate NV07.
const FRESH_MS = 90000;
const SHA = /^[a-f0-9]{40}$/i;
const deny = code => Object.freeze({ eligible: false, code, disposition: 'WAIT_OR_DENY' });
const ts = v => typeof v === 'string' ? Date.parse(v) : NaN;

export function nv07CoreRoutingDecision({ registry, commands, resource, job, lease, nowMs = Date.now() } = {}) {
  if (!registry || registry.employee_id !== 'NV07' || registry.name !== 'Google Antigravity')
    return deny('NV07_REGISTRY_IDENTITY_MISSING');
  if (!commands || commands['7'] !== 'NV07') return deny('NV07_COMMAND_MAPPING_NOT_VERIFIED');
  const admin = String(registry.admin_state || '').toUpperCase();
  if (/(RETIRED|DISABLED|PROVISIONING|NOT_YET_ROUTABLE|RUNTIME_NOT_VERIFIED|OWNER_STOPPED)/.test(admin)
    || !admin.split(/[^A-Z0-9_]+/).includes('ACTIVE')) return deny('NV07_ADMIN_NOT_ACTIVE');
  if (!resource || resource.employee_id !== 'NV07' || resource.host !== 'PC01' || resource.interface !== 'ANTIGRAVITY_CLI')
    return deny('NV07_RUNTIME_BINDING_MISSING');
  if (!['READY', 'IDLE'].includes(resource.status) || resource.acceptanceVerified !== true || resource.authVerified !== true)
    return deny('NV07_RUNTIME_NOT_ACCEPTED');
  const heartbeat = ts(resource.last_seen_at);
  if (!Number.isFinite(heartbeat) || heartbeat > nowMs || nowMs - heartbeat > FRESH_MS)
    return deny('NV07_HEARTBEAT_STALE');
  if (!job || typeof job.resourceScope !== 'string' || !job.resourceScope.trim()
    || job.employeeId !== 'NV07' || !SHA.test(String(job.sourceSha || '')))
    return deny('NV07_JOB_SCOPE_INVALID');
  const pre = nv07ProposalPreflight(job);
  if (!pre.allowed) return deny(pre.code);
  if (!lease || lease.job_id !== job.jobId || lease.employee_id !== 'NV07'
    || lease.resource_scope !== job.resourceScope || lease.state !== 'ACTIVE'
    || !Number.isFinite(ts(lease.expires_at)) || ts(lease.expires_at) <= nowMs)
    return deny('NV07_ACTIVE_LEASE_MISSING');
  return Object.freeze({
    eligible: true, code: 'NV07_READY_FOR_PROPOSAL_HANDOFF', disposition: 'ELIGIBLE_NOT_DISPATCHED',
    employeeId: 'NV07', action: job.action, jobId: job.jobId, resourceScope: job.resourceScope,
    sourceSha: job.sourceSha, note: 'This is a pure routing decision. Core still must verify actual lease owner and dispatch receipt.',
  });
}
