import { createHash, randomUUID } from 'node:crypto';
import { open, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const NV02_LOCAL_GITHUB_SELF_PULL = 'P1_P5_ONLY';
export const NV02_READY_NO_ELIGIBLE_WORK = 'READY_NO_ELIGIBLE_WORK';
export const NV02_LEASE_MARKER = '[TIGERIQ_NV02_LEASE_V1]';
export const NV02_RELEASE_MARKER = '[TIGERIQ_NV02_RELEASE_V1]';

const PRIORITIES = new Set(['P1', 'P2', 'P3', 'P4', 'P5']);
export const NV02_PRIMARY_CAPABILITIES = new Set(['general', 'reasoning', 'ui']);
export const NV02_FALLBACK_CAPABILITIES = new Set(['analysis', 'research', 'documentation', 'evidence', 'read_only', 'coding', 'knowledge', 'audit', 'maintenance', 'review']);
const HARD_GATE_MARKERS = /(?:production|paid|credential|security|destructive|device[._-]?bound|pc[._-]?operator|app[._-]?chrome)/i;
const LOCKED_WORKER_FIELDS = ['TARGET_EMPLOYEE', 'ASSIGNED_EXECUTOR', 'EXECUTOR', 'PRIMARY_EMPLOYEE'];
const localClaimLocks = new Set();
const localClaimFiles = new Map();

async function acquireLocalClaimLock(lockKey, ttlMs) {
  const path = join(tmpdir(), `tigeriq-nv02-${createHash('sha256').update(lockKey).digest('hex')}.lock`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), lockKey }));
      localClaimFiles.set(lockKey, { handle, path });
      localClaimLocks.add(lockKey);
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST' || attempt) return false;
      try {
        if (Date.now() - (await stat(path)).mtimeMs <= ttlMs) return false;
        await unlink(path);
      } catch { return false; }
    }
  }
  return false;
}

async function releaseLocalClaimLock(lockKey) {
  const lock = localClaimFiles.get(lockKey);
  localClaimFiles.delete(lockKey);
  localClaimLocks.delete(lockKey);
  if (!lock) return;
  await lock.handle.close().catch(() => {});
  await unlink(lock.path).catch(() => {});
}

function fields(body) {
  return Object.fromEntries(String(body || '').split(/\r?\n/).flatMap((line) => {
    const m = line.trim().match(/^([A-Z][A-Z0-9_]{1,80})\s*=\s*(.+)$/i);
    return m ? [[m[1].toUpperCase(), m[2].trim()]] : [];
  }));
}

export function nv02PrioritySummary(issue) {
  const m = String(issue?.title || '').match(/\b(P[0-5])\b/i) || String(issue?.priority || '').match(/^P[0-5]$/i);
  return m ? m[1].toUpperCase() : '';
}
export function nv02WorkOrderMeta(issue) { return fields(issue?.body); }

function workOrderRef(issueOrNumber) {
  const number = Number(typeof issueOrNumber === 'object' ? issueOrNumber?.number : issueOrNumber);
  return Number.isInteger(number) && number > 0 ? `#${number}` : '';
}

export function nv02LeaseAuthority(issue, leaseMeta = {}) {
  const expectedWorkOrder = workOrderRef(issue);
  const expectedScope = String(nv02WorkOrderMeta(issue).RESOURCE_SCOPE || '').trim();
  if (!expectedWorkOrder) return { valid: false, reason: 'WORK_ORDER_REQUIRED', workOrder: '', resourceScope: expectedScope };
  if (!expectedScope) return { valid: false, reason: 'RESOURCE_SCOPE_REQUIRED', workOrder: expectedWorkOrder, resourceScope: '' };
  const actualWorkOrder = String(leaseMeta?.workOrder || leaseMeta?.WORK_ORDER || '').trim();
  const actualScope = String(leaseMeta?.resourceScope || leaseMeta?.RESOURCE_SCOPE || '').trim();
  if (actualWorkOrder !== expectedWorkOrder) return { valid: false, reason: 'WORK_ORDER_MISMATCH', workOrder: expectedWorkOrder, resourceScope: expectedScope };
  if (actualScope !== expectedScope) return { valid: false, reason: 'RESOURCE_SCOPE_MISMATCH', workOrder: expectedWorkOrder, resourceScope: expectedScope };
  return { valid: true, reason: 'WORK_ORDER_AUTHORITY_VALID', workOrder: expectedWorkOrder, resourceScope: expectedScope };
}

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
    `CURRENT_WORK_ORDER=#${issue.number} - ${issue.title}`, `WORK_ORDER=#${issue.number}`, `RESOURCE_SCOPE=${lease.resourceScope}`, `LEASE_ID=${lease.leaseId}`,
    'Core không assign/route NV02. App Chrome chỉ là UI continuity/transport.',
    'P0 tuyệt đối không đọc, nhận, claim hoặc execute. Làm đúng một Work Order này đến DONE hoặc BLOCKED.',
    'Không tự tạo, mở rộng, claim hoặc allocate scope/resource ngoài Work Order này. Chỉ dùng đúng WORK_ORDER, RESOURCE_SCOPE và LEASE_ID đã cấp.',
    'Ghi evidence vào GitHub trước khi release lease; terminal xong mới tự lấy việc P1-P5 kế tiếp.', String(issue.body || ''),
  ].join('\n');
}

function leaseFields(body, marker) {
  const text = String(body || '');
  return fields(text.slice(text.indexOf(marker)));
}

export function activeResourceClaims(comments = [], nowMs = Date.now()) {
  const active = new Map();
  for (const comment of [...comments].sort((a, b) => Number(a.id) - Number(b.id))) {
    const body = String(comment?.body || '');
    const claim = body.match(/\[(?:TIGERIQ_NV02_LEASE_V1|TIGERIQ_ROLE_CLAIM_V1|APP_CHROME_CLAIM)\]/i);
    const release = body.match(/\[(?:TIGERIQ_NV02_RELEASE_V1|TIGERIQ_NV02_LEASE_RELEASE_V1|TIGERIQ_ROLE_RELEASE_V1|APP_CHROME_RELEASE)\]/i);
    const marker = claim || release;
    if (!marker) continue;
    const meta = fields(body.slice(marker.index));
    const resourceScope = String(meta.RESOURCE_SCOPE || meta.SCOPE || '').trim();
    const worker = String(meta.WORKER || '').trim().toUpperCase();
    const explicitIdentity = String(meta.LEASE_ID || meta.CLAIM_ID || '').trim();
    const identity = explicitIdentity || (claim && worker && resourceScope ? `WORKER:${worker}:${resourceScope}` : '');
    if (claim) {
      const expiry = Date.parse(meta.EXPIRES_AT || meta.LEASE_UNTIL || '');
      if (resourceScope && identity && expiry > nowMs) {
        active.set(identity, { resourceScope, worker, identity, expiry, commentId: Number(comment.id) || 0, meta });
      }
      continue;
    }
    if (explicitIdentity) {
      active.delete(explicitIdentity);
      continue;
    }
    if (resourceScope) {
      for (const [id, current] of active) {
        if (current.resourceScope === resourceScope && (!worker || !current.worker || current.worker === worker)) active.delete(id);
      }
    }
  }
  return [...active.values()].sort((a, b) => a.commentId - b.commentId);
}

export function activeResourceScopes(comments = [], nowMs = Date.now()) {
  return new Set(activeResourceClaims(comments, nowMs).map((claim) => claim.resourceScope));
}

export function resourceOwnershipConflict(issue, comments = [], { leaseId = '', nowMs = Date.now() } = {}) {
  const resourceScope = String(nv02WorkOrderMeta(issue).RESOURCE_SCOPE || '').trim();
  if (!resourceScope) return { reason: 'RESOURCE_SCOPE_REQUIRED', resourceScope: '' };
  const conflict = activeResourceClaims(comments, nowMs)
    .find((claim) => claim.resourceScope === resourceScope && claim.identity !== leaseId);
  return conflict ? { reason: 'RESOURCE_SCOPE_HELD', resourceScope, claim: conflict } : null;
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

export async function claimNv02WorkOrder({
  issue,
  comments = [],
  allComments = comments,
  refreshAllComments,
  postComment,
  ttlMs = 2 * 60 * 60 * 1000,
  claimSettleMs = 250,
  nowMs = Date.now(),
}) {
  const resourceScope = String(nv02WorkOrderMeta(issue).RESOURCE_SCOPE || '').trim();
  const workOrder = workOrderRef(issue);
  const lockKey = resourceScope;
  const before = refreshAllComments ? await refreshAllComments() : allComments;
  if (!workOrder || !resourceScope || resourceOwnershipConflict(issue, before, { nowMs }) || localClaimLocks.has(lockKey)
      || !(await acquireLocalClaimLock(lockKey, ttlMs)) || activeNv02Lease(comments, nowMs)) {
    await releaseLocalClaimLock(lockKey);
    return null;
  }
  try {
    const refreshedBeforeWrite = refreshAllComments ? await refreshAllComments() : before;
    if (resourceOwnershipConflict(issue, refreshedBeforeWrite, { nowMs })) {
      await releaseLocalClaimLock(lockKey);
      return null;
    }
    const lease = { leaseId: `NV02-${issue.number}-${randomUUID()}`, workOrder, resourceScope, expiresAt: new Date(nowMs + ttlMs).toISOString() };
    await postComment(issue.number, `${NV02_LEASE_MARKER}\nWORK_ORDER=${workOrder}\nLEASE_ID=${lease.leaseId}\nWORKER=NV02\nRESOURCE_SCOPE=${resourceScope}\nEXPIRES_AT=${lease.expiresAt}`);
    // GitHub comment creation is not a transaction. Let concurrent cross-issue
    // claims become visible, then elect the earliest still-live lease per scope.
    await new Promise((resolve) => setTimeout(resolve, claimSettleMs));
    const afterGlobal = refreshAllComments ? await refreshAllComments() : await postComment(issue.number, null);
    const winner = activeResourceClaims(afterGlobal, nowMs).find((claim) => claim.resourceScope === resourceScope);
    const winnerAuthority = nv02LeaseAuthority(issue, winner?.meta || {});
    if (winner?.identity !== lease.leaseId || !winnerAuthority.valid) {
      await postComment(issue.number, `${NV02_RELEASE_MARKER}\nWORK_ORDER=${workOrder}\nLEASE_ID=${lease.leaseId}\nWORKER=NV02\nRESOURCE_SCOPE=${resourceScope}\nSTATE=CLAIM_LOST\nRELEASED_AT=${new Date().toISOString()}`);
      await releaseLocalClaimLock(lockKey);
      return null;
    }
    return lease;
  } catch (error) {
    await releaseLocalClaimLock(lockKey);
    throw error;
  }
}
export async function releaseNv02WorkOrder({ issue, issueNumber, leaseId, resourceScope = '', state, postComment }) {
  const number = Number(issue?.number ?? issueNumber);
  const workOrder = workOrderRef(number);
  if (!issue || !workOrder || Number(issue.number) !== number) throw new Error('NV02_RELEASE_WORK_ORDER_REQUIRED');
  const authority = nv02LeaseAuthority(issue, { workOrder, resourceScope });
  if (!authority.valid) throw new Error(`NV02_RELEASE_AUTHORITY_INVALID:${authority.reason}`);
  await releaseLocalClaimLock(authority.resourceScope);
  return postComment(number, `${NV02_RELEASE_MARKER}\nWORK_ORDER=${authority.workOrder}\nLEASE_ID=${leaseId}\nWORKER=NV02\nRESOURCE_SCOPE=${authority.resourceScope}\nSTATE=${state}\nRELEASED_AT=${new Date().toISOString()}`);
}
