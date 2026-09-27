export const NV02_LOCAL_GITHUB_SELF_PULL = 'P1_P5_ONLY';
export const NV02_READY_NO_ELIGIBLE_WORK = 'READY_NO_ELIGIBLE_WORK';
export const NV02_LEASE_MARKER = '[TIGERIQ_NV02_LEASE_V1]';
export const NV02_RELEASE_MARKER = '[TIGERIQ_NV02_RELEASE_V1]';

const PRIORITIES = new Set(['P1', 'P2', 'P3', 'P4', 'P5']);
export const NV02_PRIMARY_CAPABILITIES = new Set(['general', 'reasoning', 'ui']);
export const NV02_FALLBACK_CAPABILITIES = new Set(['analysis', 'research', 'documentation', 'evidence', 'read_only', 'coding', 'knowledge', 'audit', 'maintenance', 'review']);
const HARD_GATE_MARKERS = /(?:production|paid|credential|security|destructive|device[._-]?bound|pc[._-]?operator|app[._-]?chrome)/i;
const LOCKED_WORKER_FIELDS = ['TARGET_EMPLOYEE', 'ASSIGNED_EXECUTOR', 'EXECUTOR', 'PRIMARY_EMPLOYEE'];

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

function explicitTarget(meta) {
  const targets = LOCKED_WORKER_FIELDS.map((key) => String(meta[key] || '').trim()).filter(Boolean);
  return targets.find((target) => !/^NV02$/i.test(target)) || targets[0] || '';
}

function hardGate(meta) {
  const values = Object.entries(meta)
    .filter(([key]) => !['CAPABILITY', 'MUTATION_OWNER', 'TARGET_EMPLOYEE', 'ASSIGNED_EXECUTOR', 'EXECUTOR', 'PRIMARY_EMPLOYEE', 'PREFERRED_REVIEWER'].includes(key))
    .map(([, value]) => String(value));
  return values.some((value) => HARD_GATE_MARKERS.test(value))
    || meta.REVIEW_INDEPENDENT === 'true'
    || meta.DEVICE_BOUND === 'true'
    || meta.APP_CHROME_MUTATION === 'true';
}

function dependenciesReady(meta, dependencies = new Map()) {
  const refs = String(meta.DEPENDS_ON || meta.DEPENDENCY || '').split(/[,\s]+/).map((x) => x.replace(/^#/, '')).filter(Boolean);
  return refs.every((ref) => {
    const value = dependencies instanceof Map ? dependencies.get(Number(ref)) : dependencies[Number(ref)];
    return value === true || value === 'closed' || value === 'completed' || value?.state === 'closed' || value?.state_reason === 'completed';
  });
}

export function nv02EligibleWorkOrder(issue, { heldScopes = new Set(), dependencies = new Map(), activeOwners = new Set(), allowFallback = true } = {}) {
  const meta = nv02WorkOrderMeta(issue);
  const priority = nv02PrioritySummary(issue) || String(meta.PRIORITY || '').toUpperCase();
  if (!PRIORITIES.has(priority)) return { eligible: false, reason: priority === 'P0' ? 'P0_FORBIDDEN' : 'PRIORITY_OUT_OF_RANGE' };
  if (meta.TIGERIQ_EXECUTABLE !== 'true') return { eligible: false, reason: 'NOT_EXECUTABLE' };
  if (meta.AUTO_QUEUE === 'EXCLUDED') return { eligible: false, reason: 'AUTO_QUEUE_EXCLUDED' };
  if (meta.OWNER_HOLD === 'true') return { eligible: false, reason: 'OWNER_HOLD' };
  if (!dependenciesReady(meta, dependencies)) return { eligible: false, reason: 'DEPENDENCY_NOT_READY' };
  const capability = String(meta.CAPABILITY || 'general').toLowerCase();
  const primary = NV02_PRIMARY_CAPABILITIES.has(capability);
  const target = explicitTarget(meta);
  if (target && !/^NV02$/i.test(target)) return { eligible: false, reason: 'TARGET_EMPLOYEE_LOCKED' };
  if (hardGate(meta) || HARD_GATE_MARKERS.test(capability)) return { eligible: false, reason: 'HARD_GATE_UNSAFE' };
  if ([...activeOwners].some((owner) => String(owner).toLowerCase() === String(meta.MUTATION_OWNER || '').toLowerCase())) return { eligible: false, reason: 'ACTIVE_OWNER_HELD' };
  const resourceScope = String(meta.RESOURCE_SCOPE || '').trim();
  if (!resourceScope) return { eligible: false, reason: 'RESOURCE_SCOPE_REQUIRED' };
  if (heldScopes.has(resourceScope)) return { eligible: false, reason: 'RESOURCE_SCOPE_HELD' };
  return {
    eligible: true, priority, capability, resourceScope,
    mode: /^NV02$/i.test(target) ? 'EXPLICIT_TARGET' : primary ? 'PRIMARY_ROLE' : 'SAFE_FALLBACK',
  };
}

export function selectNv02WorkOrder(issues, options = {}) {
  const eligible = (Array.isArray(issues) ? issues : [])
    // Reject P0 from summary metadata before any detail fetch or claim callback.
    .filter((issue) => nv02PrioritySummary(issue) !== 'P0')
    .map((issue) => ({ issue, result: nv02EligibleWorkOrder(issue, options) }))
    .filter(({ result }) => result.eligible);
  const rank = { EXPLICIT_TARGET: 0, PRIMARY_ROLE: 1, SAFE_FALLBACK: 2 };
  return eligible
    .sort((a, b) => rank[a.result.mode] - rank[b.result.mode]
      || a.result.priority.localeCompare(b.result.priority)
      || Number(a.issue.number) - Number(b.issue.number))[0] || null;
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

function leaseFields(body, marker) {
  const text = String(body || '');
  return fields(text.slice(text.indexOf(marker)));
}

export function activeResourceScopes(comments = [], nowMs = Date.now()) {
  const active = new Map();
  for (const comment of [...comments].sort((a, b) => Number(a.id) - Number(b.id))) {
    const body = String(comment?.body || '');
    const claim = body.match(/\[(?:TIGERIQ_NV02_LEASE_V1|TIGERIQ_ROLE_CLAIM_V1|APP_CHROME_CLAIM)\]/i);
    const release = body.match(/\[(?:TIGERIQ_NV02_RELEASE_V1|TIGERIQ_ROLE_RELEASE_V1|APP_CHROME_RELEASE)\]/i);
    if (claim) {
      const meta = fields(body.slice(claim.index).toUpperCase());
      const scope = String(meta.RESOURCE_SCOPE || meta.scope || '').trim();
      const expiry = Date.parse(meta.EXPIRES_AT || meta.LEASE_UNTIL || meta.expires_at || '');
      if (scope && expiry > nowMs) active.set(scope, { meta, identity: String(meta.LEASE_ID || meta.CLAIM_ID || meta.WORKER || '') });
    } else if (release) {
      const meta = fields(body.slice(release.index).toUpperCase());
      const scope = String(meta.RESOURCE_SCOPE || meta.scope || '').trim();
      const current = active.get(scope);
      const identity = String(meta.LEASE_ID || meta.CLAIM_ID || meta.WORKER || '');
      if (scope && current && (!identity || identity === current.identity)) active.delete(scope);
    }
  }
  return new Set(active.keys());
}

export function activeNv02Lease(comments = [], nowMs = Date.now()) {
  let active = null;
  for (const comment of [...comments].sort((a, b) => Number(a.id) - Number(b.id))) {
    const body = String(comment?.body || '');
    const marker = body.includes(NV02_LEASE_MARKER) ? NV02_LEASE_MARKER : body.includes(NV02_RELEASE_MARKER) ? NV02_RELEASE_MARKER : '';
    const meta = marker ? leaseFields(body, marker) : null;
    if (body.includes(NV02_LEASE_MARKER) && meta?.LEASE_ID && Date.parse(meta.EXPIRES_AT) > nowMs) active = meta;
    if (body.includes(NV02_RELEASE_MARKER) && meta?.LEASE_ID === active?.LEASE_ID) active = null;
  }
  return active;
}

export async function claimNv02WorkOrder({ issue, comments = [], postComment, ttlMs = 2 * 60 * 60 * 1000, claimSettleMs = 250, nowMs = Date.now() }) {
  if (activeNv02Lease(comments, nowMs)) return null;
  const resourceScope = nv02WorkOrderMeta(issue).RESOURCE_SCOPE;
  const lease = { leaseId: `NV02-${issue.number}-${nowMs}`, resourceScope, expiresAt: new Date(nowMs + ttlMs).toISOString() };
  await postComment(issue.number, `${NV02_LEASE_MARKER}\nLEASE_ID=${lease.leaseId}\nWORKER=NV02\nRESOURCE_SCOPE=${resourceScope}\nEXPIRES_AT=${lease.expiresAt}`);
  // GitHub comment creation is not a transaction. Let concurrent claim posts
  // become visible, then elect the earliest still-live lease before dispatch.
  await new Promise((resolve) => setTimeout(resolve, claimSettleMs));
  const after = await postComment(issue.number, null);
  const live = new Map();
  for (const comment of [...after].sort((a, b) => Number(a.id) - Number(b.id))) {
    const body = String(comment?.body || '');
    if (body.includes(NV02_LEASE_MARKER)) {
      const meta = leaseFields(body, NV02_LEASE_MARKER);
      if (meta?.LEASE_ID && Date.parse(meta.EXPIRES_AT) > nowMs) live.set(meta.LEASE_ID, meta);
    } else if (body.includes(NV02_RELEASE_MARKER)) {
      const meta = leaseFields(body, NV02_RELEASE_MARKER);
      if (meta?.LEASE_ID) live.delete(meta.LEASE_ID);
    }
  }
  const winner = [...live.values()][0];
  return winner?.LEASE_ID === lease.leaseId ? lease : null;
}
export function releaseNv02WorkOrder({ issueNumber, leaseId, state, postComment }) {
  return postComment(issueNumber, `${NV02_RELEASE_MARKER}\nLEASE_ID=${leaseId}\nWORKER=NV02\nSTATE=${state}\nRELEASED_AT=${new Date().toISOString()}`);
}
