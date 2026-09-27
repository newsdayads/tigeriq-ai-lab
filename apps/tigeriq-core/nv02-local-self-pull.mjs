export const NV02_LOCAL_GITHUB_SELF_PULL = 'P1_P5_ONLY';
export const NV02_READY_NO_ELIGIBLE_WORK = 'READY_NO_ELIGIBLE_WORK';
export const NV02_LEASE_MARKER = '[TIGERIQ_NV02_LEASE_V1]';
export const NV02_RELEASE_MARKER = '[TIGERIQ_NV02_RELEASE_V1]';

const PRIORITIES = new Set(['P1', 'P2', 'P3', 'P4', 'P5']);
const CAPABILITIES = new Set(['general', 'reasoning', 'ui']);

function fields(body) {
  return Object.fromEntries(String(body || '').split(/\r?\n/).flatMap((line) => {
    const m = line.trim().match(/^([A-Z][A-Z0-9_]{1,80})\s*=\s*(.+)$/);
    return m ? [[m[1], m[2].trim()]] : [];
  }));
}

export function nv02PrioritySummary(issue) {
  const m = String(issue?.title || '').match(/\b(P[0-5])\b/i) || String(issue?.priority || '').match(/^P[0-5]$/i);
  return m ? m[1].toUpperCase() : '';
}
export function nv02WorkOrderMeta(issue) { return fields(issue?.body); }

function dependenciesReady(meta, dependencies = new Map()) {
  const refs = String(meta.DEPENDS_ON || meta.DEPENDENCY || '').split(/[,\s]+/).map((x) => x.replace(/^#/, '')).filter(Boolean);
  return refs.every((ref) => {
    const value = dependencies instanceof Map ? dependencies.get(Number(ref)) : dependencies[Number(ref)];
    return value === true || value === 'closed' || value === 'completed' || value?.state === 'closed' || value?.state_reason === 'completed';
  });
}

export function nv02EligibleWorkOrder(issue, { heldScopes = new Set(), dependencies = new Map() } = {}) {
  const meta = nv02WorkOrderMeta(issue);
  const priority = nv02PrioritySummary(issue) || String(meta.PRIORITY || '').toUpperCase();
  if (!PRIORITIES.has(priority)) return { eligible: false, reason: priority === 'P0' ? 'P0_FORBIDDEN' : 'PRIORITY_OUT_OF_RANGE' };
  if (meta.TIGERIQ_EXECUTABLE !== 'true') return { eligible: false, reason: 'NOT_EXECUTABLE' };
  if (meta.AUTO_QUEUE === 'EXCLUDED') return { eligible: false, reason: 'AUTO_QUEUE_EXCLUDED' };
  if (meta.OWNER_HOLD === 'true') return { eligible: false, reason: 'OWNER_HOLD' };
  if (!dependenciesReady(meta, dependencies)) return { eligible: false, reason: 'DEPENDENCY_NOT_READY' };
  const capability = String(meta.CAPABILITY || 'general').toLowerCase();
  if (!CAPABILITIES.has(capability)) return { eligible: false, reason: 'CAPABILITY_MISMATCH' };
  const resourceScope = String(meta.RESOURCE_SCOPE || '').trim();
  if (!resourceScope) return { eligible: false, reason: 'RESOURCE_SCOPE_REQUIRED' };
  if (heldScopes.has(resourceScope) || (meta.MUTATION_OWNER && meta.MUTATION_OWNER !== 'NV02')) return { eligible: false, reason: 'RESOURCE_SCOPE_HELD' };
  return { eligible: true, priority, capability, resourceScope };
}

export function selectNv02WorkOrder(issues, options = {}) {
  return (Array.isArray(issues) ? issues : [])
    // Reject P0 from summary metadata before any detail fetch or claim callback.
    .filter((issue) => nv02PrioritySummary(issue) !== 'P0')
    .map((issue) => ({ issue, result: nv02EligibleWorkOrder(issue, options) }))
    .filter(({ result }) => result.eligible)
    .sort((a, b) => a.result.priority.localeCompare(b.result.priority) || Number(a.issue.number) - Number(b.issue.number))[0] || null;
}

export function resolveNv02Command02State({ currentWorkOrder, currentCheckpoint, active = true } = {}) {
  if (currentWorkOrder && active) return { state: 'ACTIVE_RESUME', workOrder: currentWorkOrder, checkpoint: currentCheckpoint || null };
  return { state: 'SELF_PULL', policy: NV02_LOCAL_GITHUB_SELF_PULL };
}
export function noEligibleNv02Work() { return { state: NV02_READY_NO_ELIGIBLE_WORK, policy: NV02_LOCAL_GITHUB_SELF_PULL }; }

export function buildNv02LocalSelfPullPrompt(issue, lease) {
  return [
    'LÀM — NO YAPPING.', `NV02_LOCAL_GITHUB_SELF_PULL=${NV02_LOCAL_GITHUB_SELF_PULL}`,
    `CURRENT_WORK_ORDER=#${issue.number} - ${issue.title}`, `RESOURCE_SCOPE=${lease.resourceScope}`, `LEASE_ID=${lease.leaseId}`,
    'Core không assign/route NV02. App Chrome chỉ là UI continuity/transport.',
    'P0 tuyệt đối không đọc, nhận, claim hoặc execute. Làm đúng một Work Order này đến DONE hoặc BLOCKED.',
    'Ghi evidence vào GitHub trước khi release lease; terminal xong mới tự lấy việc P1-P5 kế tiếp.', String(issue.body || ''),
  ].join('\n');
}

function leaseFields(body) { return fields(String(body || '').slice(String(body || '').indexOf(NV02_LEASE_MARKER))); }
export function activeNv02Lease(comments = [], nowMs = Date.now()) {
  let active = null;
  for (const comment of [...comments].sort((a, b) => Number(a.id) - Number(b.id))) {
    const body = String(comment?.body || '');
    const meta = body.includes(NV02_LEASE_MARKER) || body.includes(NV02_RELEASE_MARKER) ? leaseFields(body) : null;
    if (body.includes(NV02_LEASE_MARKER) && meta?.LEASE_ID && Date.parse(meta.EXPIRES_AT) > nowMs) active = meta;
    if (body.includes(NV02_RELEASE_MARKER) && meta?.LEASE_ID === active?.LEASE_ID) active = null;
  }
  return active;
}

export async function claimNv02WorkOrder({ issue, comments = [], postComment, ttlMs = 2 * 60 * 60 * 1000, nowMs = Date.now() }) {
  if (activeNv02Lease(comments, nowMs)) return null;
  const resourceScope = nv02WorkOrderMeta(issue).RESOURCE_SCOPE;
  const lease = { leaseId: `NV02-${issue.number}-${nowMs}`, resourceScope, expiresAt: new Date(nowMs + ttlMs).toISOString() };
  await postComment(issue.number, `${NV02_LEASE_MARKER}\nLEASE_ID=${lease.leaseId}\nWORKER=NV02\nRESOURCE_SCOPE=${resourceScope}\nEXPIRES_AT=${lease.expiresAt}`);
  const after = await postComment(issue.number, null);
  return activeNv02Lease(after, nowMs)?.LEASE_ID === lease.leaseId ? lease : null;
}
export function releaseNv02WorkOrder({ issueNumber, leaseId, state, postComment }) {
  return postComment(issueNumber, `${NV02_RELEASE_MARKER}\nLEASE_ID=${leaseId}\nWORKER=NV02\nSTATE=${state}\nRELEASED_AT=${new Date().toISOString()}`);
}
