import { createHash, randomUUID } from 'node:crypto';
import { open, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const NV02_LOCAL_GITHUB_SELF_PULL = 'P1_P5_ONLY';
export const NV02_READY_NO_ELIGIBLE_WORK = 'READY_NO_ELIGIBLE_WORK';
export const NV02_LEASE_MARKER = '[TIGERIQ_NV02_LEASE_V1]';
export const NV02_RELEASE_MARKER = '[TIGERIQ_NV02_RELEASE_V1]';
export const NV02_TAKEOVER_STALE_MS = 15 * 60 * 1000;
export const NV02_TAKEOVER_NO_PROGRESS_ROUNDS = 3;

const PRIORITIES = new Set(['P1', 'P2', 'P3', 'P4', 'P5']);
export const NV02_PRIMARY_CAPABILITIES = new Set(['general', 'reasoning', 'ui']);
export const NV02_FALLBACK_CAPABILITIES = new Set(['analysis', 'research', 'documentation', 'evidence', 'read_only', 'coding', 'knowledge', 'audit', 'maintenance', 'review']);
const HARD_GATE_MARKERS = /(?:production|paid|credential|security|destructive|irreversible|app[._-]?chrome)/i;
const DIRECT_PATH_CAPABILITIES = new Set(['pc_operator', 'device_bound']);
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
function currentAuthoritySection(body) {
  const text = String(body || '');
  const trimmed = text.trimStart();
  if (!/^##\s+OWNER\b/i.test(trimmed)) return text;
  const firstBreak = trimmed.indexOf('\n');
  if (firstBreak < 0) return trimmed;
  const rest = trimmed.slice(firstBreak + 1);
  const nextHeading = rest.search(/^##\s+/m);
  return nextHeading < 0 ? trimmed : trimmed.slice(0, firstBreak + 1 + nextHeading);
}

export function nv02WorkOrderMeta(issue) { return fields(currentAuthoritySection(issue?.body)); }

function nv02RearmEpochMs(issue) {
  const meta = nv02WorkOrderMeta(issue);
  const state = `${meta.CURRENT_STATE || ''} ${meta.STATE || ''}`;
  const explicitlyRearmed = meta.OWNER_REARM === 'true'
    || /REARM|READY_FOR_NV02_SELF_PULL/i.test(state);
  if (!explicitlyRearmed || meta.TIGERIQ_EXECUTABLE !== 'true' || meta.AUTO_QUEUE === 'EXCLUDED') return 0;
  const epoch = Date.parse(String(meta.REARMED_AT || meta.QUEUE_REARMED_AT || meta.EPOCH_STARTED_AT || ''));
  return Number.isFinite(epoch) ? epoch : 0;
}

export function nv02HasTerminalEvidence(issue, comments = []) {
  if (issue?.state === 'closed' && issue?.state_reason === 'completed') return true;
  const epochMs = nv02RearmEpochMs(issue);
  return (Array.isArray(comments) ? comments : [])
    .filter((comment) => {
      const body = String(comment?.body || '');
      return body.includes(NV02_LEASE_MARKER) || body.includes(NV02_RELEASE_MARKER) || /WORKER=NV02/i.test(body);
    })
    .filter((comment) => !epochMs || commentAtMs(comment) >= epochMs)
    .some((comment) => /^(?:STATE|CURRENT_STATE)=(?:DONE|BLOCKED)$/mi.test(String(comment?.body || '')));
}

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

export function nv02AssignedWorker(issue) {
  return String(explicitTarget(nv02WorkOrderMeta(issue)) || '').trim().toUpperCase();
}

function capabilityDirectPath(meta, capability) {
  if (!DIRECT_PATH_CAPABILITIES.has(capability)) return true;
  return meta.NV02_DIRECT_EXECUTION === 'true'
    || /^DIRECT$/i.test(String(meta.NV02_EXECUTION_PATH || ''))
    || /^DIRECT_/i.test(String(meta.NV02_EXECUTION_PATH || ''));
}

function selfReviewConflict(meta, capability) {
  const reviewWork = capability === 'review' || meta.REVIEW_ONLY === 'true' || meta.REVIEW_INDEPENDENT === 'true';
  const implementer = String(meta.IMPLEMENTER || meta.IMPLEMENTATION_OWNER || '').trim().toUpperCase();
  return reviewWork && implementer === 'NV02';
}

function independentCodingLaneReservation(meta) {
  const ownerProxy = String(meta.OWNER_PROXY || '').trim().toUpperCase();
  return ownerProxy === 'NV02' || meta.INDEPENDENT_REPAIR_REQUIRED === 'true';
}

function hardGate(meta) {
  const values = Object.entries(meta)
    .filter(([key]) => !['CAPABILITY', 'MUTATION_OWNER', 'TARGET_EMPLOYEE', 'ASSIGNED_EXECUTOR', 'EXECUTOR', 'PRIMARY_EMPLOYEE', 'PREFERRED_REVIEWER'].includes(key))
    .map(([, value]) => String(value));
  return values.some((value) => HARD_GATE_MARKERS.test(value))
    || meta.APP_CHROME_MUTATION === 'true'
    || meta.APP_CHROME_SELF_MAINTENANCE === 'true';
}

function dependenciesReady(meta, dependencies = new Map()) {
  const refs = String(meta.DEPENDS_ON || meta.DEPENDENCY || '').split(/[,\s]+/).map((x) => x.replace(/^#/, '')).filter(Boolean);
  return refs.every((ref) => {
    const value = dependencies instanceof Map ? dependencies.get(Number(ref)) : dependencies[Number(ref)];
    return value === true || value === 'closed' || value === 'completed' || value?.state === 'closed' || value?.state_reason === 'completed';
  });
}

function commentAtMs(comment) {
  const direct = Date.parse(String(comment?.updated_at || comment?.created_at || ''));
  if (Number.isFinite(direct)) return direct;
  const meta = fields(comment?.body);
  for (const key of ['HEARTBEAT_AT', 'PROGRESS_AT', 'UPDATED_AT', 'CLAIMED_AT', 'CREATED_AT']) {
    const value = Date.parse(String(meta[key] || ''));
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function workerMentioned(body, worker) {
  const text = String(body || '');
  const id = String(worker || '').toUpperCase();
  return [
    new RegExp(`^(?:WORKER|TARGET_EMPLOYEE|ASSIGNED_EXECUTOR|EXECUTOR|PRIMARY_EMPLOYEE|IMPLEMENTER)=${id}$`, 'mi'),
    new RegExp(`\\bImplementer:\\s*${id}\\b`, 'i'),
    new RegExp(`\\bworker[=:]\\s*${id}\\b`, 'i'),
  ].some((pattern) => pattern.test(text));
}

function progressMarker(body) {
  return /\[(?:CLAIM|PROGRESS|RESULT|HEARTBEAT)\]/i.test(String(body || ''))
    || /^(?:STATE|CURRENT_STATE)=(?:WORKING|READY|STALLED|BLOCKED|DONE|COMPLETED)$/mi.test(String(body || ''))
    || /^(?:HEARTBEAT_AT|PROGRESS_AT)=/mi.test(String(body || ''));
}

function noProgressRounds(issue, comments) {
  let rounds = 0;
  for (const text of [String(issue?.body || ''), ...(Array.isArray(comments) ? comments.map((x) => String(x?.body || '')) : [])]) {
    const match = text.match(/^(?:NO_PROGRESS_ROUNDS|STALL_COUNT|STALLED_ROUNDS)=(\d+)$/mi);
    if (match) rounds = Math.max(rounds, Number(match[1]) || 0);
  }
  return rounds;
}

function takeoverWorkerBlocked(issue, comments, target) {
  const texts = [String(issue?.body || ''), ...(Array.isArray(comments) ? comments.map((x) => String(x?.body || '')) : [])];
  for (const text of texts) {
    if (!/(?:STATE|CURRENT_STATE)=BLOCKED/i.test(text)) continue;
    if (target && !workerMentioned(text, target) && !new RegExp(`\\b${target}\\b`, 'i').test(text)) continue;
    const reason = String(text.match(/^(?:BLOCKER|BLOCKED_REASON|REASON)=(.+)$/mi)?.[1] || text);
    if (/owner|hold|dependency|production|paid|credential|security|destructive|irreversible|external[_ -]?wait/i.test(reason)) continue;
    if (/worker|transport|timeout|stall|retry|offline|unavailable|no[_ -]?heartbeat|capabil/i.test(reason)) return true;
  }
  return false;
}

function codingLaneFallbackStatus(meta, comments = [], { nowMs = Date.now(), staleMs = NV02_TAKEOVER_STALE_MS } = {}) {
  if (!independentCodingLaneReservation(meta)) return null;
  const ordered = [...(Array.isArray(comments) ? comments : [])]
    .sort((a, b) => (commentAtMs(a) - commentAtMs(b)) || (Number(a?.id || 0) - Number(b?.id || 0)));
  let latest = null;
  const failedObjectives = new Set();
  for (const comment of ordered) {
    const text = String(comment?.body || '');
    const objectiveId = text.match(/\b(CODEOBJ-[0-9A-Za-z-]+)\b/i)?.[1]?.toUpperCase() || '';
    const at = commentAtMs(comment);
    const blockedMarker = /\[(?:BLOCKED_FINAL|BỊ CHẶN)\]/i.test(text);
    const hardReason = /\b(?:HARD_BLOCKER|OWNER_HOLD|DEPENDENCY_NOT_READY|BROWSER_AUTH|AUTHORIZATION_REQUIRED|HUMAN_POLICY|SCOPE_VIOLATION|OUT_OF_SCOPE|POLICY_BLOCK|POLICY_REJECT|SECURITY|CREDENTIAL|PAID|DESTRUCTIVE|IRREVERSIBLE|PRODUCTION|APP_CHROME|ISSUE_CLOSED_OR_SUPERSEDED|SUPERSEDED|CANCELLED|CANCELED)\b/i.test(text)
      || /REVIEW_(?:REJECTED|CHANGES).*HUMAN/i.test(text);
    const terminalHardBlock = blockedMarker && hardReason;
    const retryScheduled = objectiveId && /\[(?:RETRY_SCHEDULED|LÊN LỊCH THỬ LẠI)\]/i.test(text);
    const completed = objectiveId && (
      /\bis completed\b/i.test(text)
      || /\[(?:RESULT|KẾT QUẢ)\][\s\S]*\b(?:completed|done|hoàn tất)\b/i.test(text)
    );
    const structuralActive = objectiveId && !retryScheduled && (
      /\[(?:CLAIM|RETRY_DISPATCHED|RECOVERY_REARMED|STALE_RESULT_REARMED|REOPEN_REARMED|KÍCH HOẠT LẠI|TIẾP NHẬN)\]/i.test(text)
      || /accepted this issue as\s+CODEOBJ-/i.test(text)
      || /Automatic coding pipeline is active/i.test(text)
    );
    const terminalFailure = !terminalHardBlock && (
      /RETRY_BUDGET_EXHAUSTED/i.test(text)
      || (objectiveId && blockedMarker)
    );
    const progressActive = objectiveId && !structuralActive && !retryScheduled && !completed && !terminalHardBlock && !terminalFailure
      && !/\bis failed\b|CODING_ALL_BATCHES_NOOP/i.test(text)
      && /\[(?:PROGRESS|TIẾN ĐỘ|HEARTBEAT)\]/i.test(text);
    const failed = objectiveId && !structuralActive && !progressActive && !retryScheduled && !completed && (
      terminalFailure || /\bis failed\b|CODING_ALL_BATCHES_NOOP/i.test(text)
    );
    if (failed) failedObjectives.add(objectiveId);
    if (terminalHardBlock) latest = { kind: 'hard_blocked', objectiveId, terminalFailure: false, at };
    else if (completed) latest = { kind: 'completed', objectiveId, terminalFailure: false, at };
    else if (structuralActive) latest = { kind: 'active', objectiveId, terminalFailure: false, at, staleEligible: false };
    else if (retryScheduled) {
      const nextAt = Date.parse(String(text.match(/\bnextAt=([^\s]+)/i)?.[1] || ''));
      latest = { kind: 'scheduled', objectiveId, terminalFailure: false, at, nextAt: Number.isFinite(nextAt) ? nextAt : 0 };
    } else if (progressActive) latest = { kind: 'active', objectiveId, terminalFailure: false, at, staleEligible: true };
    else if (failed) latest = { kind: 'failed', objectiveId, terminalFailure, at };
  }
  if (!latest) return { eligible: false, reason: 'INDEPENDENT_CODING_LANE_RESERVED' };
  if (latest.kind === 'hard_blocked') return { eligible: false, reason: 'INDEPENDENT_CODING_LANE_HARD_BLOCKED', latest };
  if (latest.kind === 'completed') return { eligible: false, reason: 'INDEPENDENT_CODING_LANE_COMPLETED', latest };
  const stale = latest.at > 0 && nowMs - latest.at >= staleMs;
  if (latest.kind === 'active' && (!latest.staleEligible || !stale)) {
    return { eligible: false, reason: 'INDEPENDENT_CODING_LANE_ACTIVE', latest };
  }
  if (latest.kind === 'active') return {
    eligible: true,
    reason: 'INDEPENDENT_CODING_LANE_PROGRESS_STALE',
    target: 'CODING_LANE',
    needsRelease: false,
    activeClaim: null,
    failureCount: failedObjectives.size,
    latest,
  };
  if (latest.kind === 'scheduled') {
    const deadline = (latest.nextAt || latest.at) + staleMs;
    if (deadline > nowMs) return { eligible: false, reason: 'INDEPENDENT_CODING_LANE_RETRY_SCHEDULED', latest };
    return {
      eligible: true,
      reason: 'INDEPENDENT_CODING_LANE_SCHEDULE_MISSED',
      target: 'CODING_LANE',
      needsRelease: false,
      activeClaim: null,
      failureCount: failedObjectives.size,
      latest,
    };
  }
  if (latest.kind === 'failed' && !latest.terminalFailure
      && failedObjectives.size < NV02_TAKEOVER_NO_PROGRESS_ROUNDS && !stale) {
    return { eligible: false, reason: 'INDEPENDENT_CODING_LANE_RETRY_BUDGET_OPEN', latest, failureCount: failedObjectives.size };
  }
  return {
    eligible: true,
    reason: latest.terminalFailure
      ? 'INDEPENDENT_CODING_LANE_TERMINAL_FAILED'
      : failedObjectives.size >= NV02_TAKEOVER_NO_PROGRESS_ROUNDS
        ? 'INDEPENDENT_CODING_LANE_RETRIES_EXHAUSTED'
        : 'INDEPENDENT_CODING_LANE_FAILED_STALE',
    target: 'CODING_LANE',
    needsRelease: false,
    activeClaim: null,
    failureCount: failedObjectives.size,
    latest,
  };
}
export function nv02TakeoverStatus(issue, comments = [], {
  nowMs = Date.now(),
  staleMs = NV02_TAKEOVER_STALE_MS,
  noProgressThreshold = NV02_TAKEOVER_NO_PROGRESS_ROUNDS,
} = {}) {
  const meta = nv02WorkOrderMeta(issue);
  const target = nv02AssignedWorker(issue);
  const capability = String(meta.CAPABILITY || 'general').toLowerCase();
  const resourceScope = String(meta.RESOURCE_SCOPE || '').trim();
  if (selfReviewConflict(meta, capability)) return { eligible: false, reason: 'SELF_REVIEW_FORBIDDEN', target, resourceScope };
  if (!capabilityDirectPath(meta, capability)) return { eligible: false, reason: 'NO_NV02_DIRECT_EXECUTION_PATH', target, resourceScope };
  const codingFallback = codingLaneFallbackStatus(meta, comments, { nowMs, staleMs });
  if (codingFallback?.eligible) return { ...codingFallback, resourceScope };
  // Independent Coding Lane reservation is authoritative until its own evidence opens fallback.
  // Do not fall through to generic stale-assignee takeover merely because a target worker is old.
  if (codingFallback) return { ...codingFallback, target, resourceScope };
  if (!target || target === 'NV02') return { eligible: false, reason: 'NO_FOREIGN_ASSIGNEE', target, resourceScope };

  const rounds = noProgressRounds(issue, comments);
  const explicitStalled = [String(issue?.body || ''), ...comments.map((x) => String(x?.body || ''))]
    .some((text) => /^(?:STATE|CURRENT_STATE)=STALLED$/mi.test(text));
  const workerBlocked = takeoverWorkerBlocked(issue, comments, target);
  const activeClaim = activeResourceClaims(comments, nowMs)
    .find((claim) => claim.resourceScope === resourceScope && claim.worker === target);

  let latestProgressAt = 0;
  for (const comment of comments) {
    if (workerMentioned(comment?.body, target) && progressMarker(comment?.body)) {
      latestProgressAt = Math.max(latestProgressAt, commentAtMs(comment));
    }
  }
  const assignedAt = Date.parse(String(meta.ASSIGNED_AT || issue?.updated_at || issue?.created_at || ''));
  const claimAt = Number(activeClaim?.createdAtMs || 0);
  const baseline = Math.max(latestProgressAt, claimAt, Number.isFinite(assignedAt) ? assignedAt : 0);
  const stale = baseline > 0 && nowMs - baseline >= staleMs;
  const evidenced = explicitStalled || workerBlocked || rounds >= noProgressThreshold || stale;

  if (!evidenced) return {
    eligible: false,
    reason: activeClaim ? 'ASSIGNEE_LEASE_FRESH' : 'ASSIGNEE_STALE_UNPROVEN',
    target, resourceScope, activeClaim: activeClaim || null, latestProgressAt, rounds,
  };

  return {
    eligible: true,
    reason: explicitStalled ? 'ASSIGNEE_STALLED'
      : workerBlocked ? 'ASSIGNEE_BLOCKED_WORKER_OR_TRANSPORT'
        : rounds >= noProgressThreshold ? 'NO_PROGRESS_ROUNDS_EXHAUSTED'
          : 'ASSIGNEE_HEARTBEAT_STALE',
    target,
    resourceScope,
    activeClaim: activeClaim || null,
    needsRelease: Boolean(activeClaim),
    latestProgressAt,
    rounds,
  };
}

export async function releaseStaleAssigneeLease({ issue, takeover, postComment, nowMs = Date.now() }) {
  if (!takeover?.eligible || !takeover?.needsRelease || !takeover?.activeClaim) return { released: false, reason: 'NO_RELEASE_REQUIRED' };
  const resourceScope = String(nv02WorkOrderMeta(issue).RESOURCE_SCOPE || '').trim();
  const claim = takeover.activeClaim;
  if (!resourceScope || claim.resourceScope !== resourceScope || !claim.worker || claim.worker === 'NV02') {
    throw new Error('NV02_TAKEOVER_RELEASE_INVALID');
  }
  await postComment(issue.number, `[TIGERIQ_ROLE_RELEASE_V1]\nWORKER=${claim.worker}\nRESOURCE_SCOPE=${resourceScope}\nSTATE=STALE_TAKEOVER_BY_NV02\nTAKEOVER_REASON=${takeover.reason}\nRELEASED_AT=${new Date(nowMs).toISOString()}`);
  return { released: true, worker: claim.worker, resourceScope, reason: takeover.reason };
}

export function nv02EligibleWorkOrder(issue, { heldScopes = new Set(), dependencies = new Map(), activeOwners = new Set(), allowFallback = true, takeoverStatuses = new Map() } = {}) {
  const meta = nv02WorkOrderMeta(issue);
  const priority = nv02PrioritySummary(issue) || String(meta.PRIORITY || '').toUpperCase();
  if (!PRIORITIES.has(priority)) return { eligible: false, reason: priority === 'P0' ? 'P0_FORBIDDEN' : 'PRIORITY_OUT_OF_RANGE' };
  if (issue?.state === 'closed') return { eligible: false, reason: 'WORK_ORDER_CLOSED' };
  const lifecycleState = `${meta.CURRENT_STATE || ''} ${meta.STATE || ''}`.toUpperCase();
  if (/SUPERSEDED|CANCELLED|CANCELED|RETIRED/.test(lifecycleState)) return { eligible: false, reason: 'WORK_ORDER_SUPERSEDED_OR_CANCELLED' };
  if (/^(?:true|yes|1)$/i.test(String(meta.DONE || '')) && !/REARM|READY/.test(lifecycleState)) return { eligible: false, reason: 'WORK_ORDER_TERMINAL' };
  if (meta.TIGERIQ_EXECUTABLE !== 'true') return { eligible: false, reason: 'NOT_EXECUTABLE' };
  if (meta.AUTO_QUEUE === 'EXCLUDED') return { eligible: false, reason: 'AUTO_QUEUE_EXCLUDED' };
  if (meta.OWNER_HOLD === 'true') return { eligible: false, reason: 'OWNER_HOLD' };
  if (!dependenciesReady(meta, dependencies)) return { eligible: false, reason: 'DEPENDENCY_NOT_READY' };
  const capability = String(meta.CAPABILITY || 'general').toLowerCase();
  const primary = NV02_PRIMARY_CAPABILITIES.has(capability);
  const target = explicitTarget(meta);
  const takeover = takeoverStatuses instanceof Map ? takeoverStatuses.get(Number(issue?.number)) : takeoverStatuses?.[Number(issue?.number)];
  if (independentCodingLaneReservation(meta) && !takeover?.eligible) {
    return { eligible: false, reason: takeover?.reason || 'INDEPENDENT_CODING_LANE_RESERVED' };
  }
  if (target && !/^NV02$/i.test(target) && !takeover?.eligible) return { eligible: false, reason: takeover?.reason || 'TARGET_EMPLOYEE_LOCKED' };
  if (hardGate(meta) || HARD_GATE_MARKERS.test(capability)) return { eligible: false, reason: 'HARD_GATE_UNSAFE' };
  if (selfReviewConflict(meta, capability)) return { eligible: false, reason: 'SELF_REVIEW_FORBIDDEN' };
  if (!capabilityDirectPath(meta, capability)) return { eligible: false, reason: 'NO_NV02_DIRECT_EXECUTION_PATH' };
  if ([...activeOwners].some((owner) => String(owner).toLowerCase() === String(meta.MUTATION_OWNER || '').toLowerCase())) return { eligible: false, reason: 'ACTIVE_OWNER_HELD' };
  const resourceScope = String(meta.RESOURCE_SCOPE || '').trim();
  if (!resourceScope) return { eligible: false, reason: 'RESOURCE_SCOPE_REQUIRED' };
  if (heldScopes.has(resourceScope) && !(takeover?.eligible && takeover?.needsRelease && takeover?.activeClaim?.resourceScope === resourceScope)) {
    return { eligible: false, reason: 'RESOURCE_SCOPE_HELD' };
  }
  return {
    eligible: true, priority, capability, resourceScope, takeover: takeover?.eligible ? takeover : null,
    mode: /^NV02$/i.test(target) ? 'EXPLICIT_TARGET'
      : takeover?.eligible ? 'STALE_ASSIGNEE_TAKEOVER'
        : primary ? 'PRIMARY_ROLE' : 'SAFE_FALLBACK',
  };
}

export function selectNv02WorkOrder(issues, options = {}) {
  const eligible = (Array.isArray(issues) ? issues : [])
    // Reject P0 from summary metadata before any detail fetch or claim callback.
    .filter((issue) => nv02PrioritySummary(issue) !== 'P0')
    .map((issue) => ({ issue, result: nv02EligibleWorkOrder(issue, options) }))
    .filter(({ result }) => result.eligible);
  const rank = { EXPLICIT_TARGET: 0, STALE_ASSIGNEE_TAKEOVER: 1, PRIMARY_ROLE: 2, SAFE_FALLBACK: 3 };
  return eligible
    .sort((a, b) => rank[a.result.mode] - rank[b.result.mode]
      || a.result.priority.localeCompare(b.result.priority)
      || Number(a.issue.number) - Number(b.issue.number))[0] || null;
}

export function nv02AuthorityRevision(issue) {
  const meta = nv02WorkOrderMeta(issue);
  const authority = {
    workOrder: workOrderRef(issue),
    resourceScope: String(meta.RESOURCE_SCOPE || '').trim(),
    issueState: String(issue?.state || '').trim().toLowerCase(),
    stateReason: String(issue?.state_reason || '').trim().toLowerCase(),
    currentState: String(meta.CURRENT_STATE || meta.STATE || '').trim().toUpperCase(),
    done: String(meta.DONE || '').trim().toLowerCase(),
    executable: String(meta.TIGERIQ_EXECUTABLE || '').trim().toLowerCase(),
    autoQueue: String(meta.AUTO_QUEUE || '').trim().toUpperCase(),
    mutationOwner: String(meta.MUTATION_OWNER || '').trim().toUpperCase(),
  };
  return createHash('sha256').update(JSON.stringify(authority)).digest('hex').slice(0, 16);
}

export function nv02AuthoritativeResumeGuard({
  currentWorkOrder,
  currentResourceScope = '',
  currentSourceRevision = '',
  chatState = '',
  chatBlocker = '',
  authoritativeIssue,
  authoritativeComments = [],
} = {}) {
  if (!currentWorkOrder) return {
    valid: false, action: 'SELF_PULL', reason: 'CURRENT_WORK_ORDER_MISSING',
    archiveAllowed: false,
  };
  if (!authoritativeIssue) return {
    valid: false, action: 'REFRESH_REQUIRED', reason: 'AUTHORITATIVE_ISSUE_REQUIRED',
    archiveAllowed: false,
  };

  const expectedScope = String(nv02WorkOrderMeta(authoritativeIssue).RESOURCE_SCOPE || '').trim();
  const authority = nv02LeaseAuthority(authoritativeIssue, {
    workOrder: currentWorkOrder,
    resourceScope: currentResourceScope || expectedScope,
  });
  const authoritativeRevision = nv02AuthorityRevision(authoritativeIssue);
  if (!authority.valid) return {
    valid: false, action: 'REFRESH_REQUIRED', reason: authority.reason,
    archiveAllowed: false, authoritativeRevision,
  };

  const meta = nv02WorkOrderMeta(authoritativeIssue);
  const durableTerminal = nv02HasTerminalEvidence(authoritativeIssue, authoritativeComments);
  const declaredTerminal = /^(?:true|yes|1)$/i.test(String(meta.DONE || ''))
    || /^(?:DONE|COMPLETED)$/i.test(String(meta.CURRENT_STATE || meta.STATE || ''));
  const terminal = durableTerminal || declaredTerminal;
  const sourceRevisionMissing = !String(currentSourceRevision || '').trim();
  const revisionMismatch = !sourceRevisionMissing && currentSourceRevision !== authoritativeRevision;
  const staleChatState = terminal && /WAIT(?:ING)?|BLOCKED|WORKING|MERGE|APPROVAL/i.test(`${chatState} ${chatBlocker}`);

  if (terminal || sourceRevisionMissing || revisionMismatch || staleChatState) {
    return {
      valid: false,
      action: 'REFRESH_REQUIRED',
      reason: terminal ? 'AUTHORITATIVE_TERMINAL'
        : sourceRevisionMissing ? 'SOURCE_REVISION_REQUIRED'
          : 'SOURCE_REVISION_MISMATCH',
      archiveAllowed: durableTerminal,
      authoritativeRevision,
      next: 'SELF_PULL',
    };
  }
  return {
    valid: true, action: 'RESUME', reason: 'AUTHORITATIVE_STATE_CURRENT',
    archiveAllowed: false, authoritativeRevision,
  };
}

export function resolveNv02Command02State({
  currentWorkOrder,
  currentCheckpoint,
  currentResourceScope = '',
  currentSourceRevision = '',
  chatState = '',
  chatBlocker = '',
  authoritativeIssue,
  authoritativeComments = [],
  active = true,
} = {}) {
  if (currentWorkOrder && active) {
    const guard = nv02AuthoritativeResumeGuard({
      currentWorkOrder,
      currentResourceScope,
      currentSourceRevision,
      chatState,
      chatBlocker,
      authoritativeIssue,
      authoritativeComments,
    });
    if (!guard.valid) return { state: 'REFRESH_REQUIRED', workOrder: currentWorkOrder, checkpoint: currentCheckpoint || null, ...guard };
    return {
      state: 'ACTIVE_RESUME', workOrder: currentWorkOrder, checkpoint: currentCheckpoint || null,
      authoritativeRevision: guard.authoritativeRevision,
    };
  }
  return { state: 'SELF_PULL', policy: NV02_LOCAL_GITHUB_SELF_PULL };
}
export function noEligibleNv02Work() { return { state: NV02_READY_NO_ELIGIBLE_WORK, policy: NV02_LOCAL_GITHUB_SELF_PULL }; }

export function buildNv02LocalSelfPullPrompt(issue, lease) {
  const sourceRevision = nv02AuthorityRevision(issue);
  return [
    'LÀM — NO YAPPING.', `NV02_LOCAL_GITHUB_SELF_PULL=${NV02_LOCAL_GITHUB_SELF_PULL}`,
    `CURRENT_WORK_ORDER=#${issue.number} - ${issue.title}`, `WORK_ORDER=#${issue.number}`, `RESOURCE_SCOPE=${lease.resourceScope}`, `LEASE_ID=${lease.leaseId}`, `SOURCE_REVISION=${sourceRevision}`,
    'Core không assign/route NV02. App Chrome chỉ là UI continuity/transport.',
    'P0 tuyệt đối không đọc, nhận, claim hoặc execute. Làm đúng một Work Order này đến DONE hoặc BLOCKED.',
    'Trước mỗi lần tiếp tục hoặc mutation: đọc lại WORK_ORDER authoritative trên GitHub. Nếu terminal hoặc SOURCE_REVISION/state lệch context hiện tại thì dừng continuation cũ, refresh context có giới hạn và self-pull lại; không archive nếu chưa có durable terminal evidence.',
    lease.takeoverFrom ? `TAKEOVER_FROM=${lease.takeoverFrom}; TAKEOVER_REASON=${lease.takeoverReason || 'STALE_ASSIGNEE'}; lease cũ đã release trước claim.` : 'TAKEOVER_FROM=NONE',
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
        active.set(identity, {
          resourceScope, worker, identity, expiry, commentId: Number(comment.id) || 0,
          createdAtMs: commentAtMs(comment), meta,
        });
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
    const lease = {
      leaseId: `NV02-${issue.number}-${randomUUID()}`, workOrder, resourceScope,
      sourceRevision: nv02AuthorityRevision(issue),
      expiresAt: new Date(nowMs + ttlMs).toISOString(),
    };
    await postComment(issue.number, `${NV02_LEASE_MARKER}\nWORK_ORDER=${workOrder}\nLEASE_ID=${lease.leaseId}\nWORKER=NV02\nRESOURCE_SCOPE=${resourceScope}\nSOURCE_REVISION=${lease.sourceRevision}\nEXPIRES_AT=${lease.expiresAt}`);
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
