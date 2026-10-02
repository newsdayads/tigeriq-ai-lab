import { parseExecutableIssue } from '../apps/tigeriq-core/github-intake.mjs';
import { parseCodingIssue } from '../apps/tigeriq-core/github-coding-intake.mjs';
import { hasTerminalBlockedLabel } from '../apps/tigeriq-core/github-lifecycle-label.mjs';
import { loadSkillPromotionState } from '../apps/tigeriq-core/skill-promotion.mjs';
import { githubRequestJson, githubTransportSnapshot } from '../apps/tigeriq-core/github-shared-client.mjs';
import { localizeOwnerFacingText, ownerFacingWorkRow } from '../apps/tigeriq-core/owner-facing-vietnamese.mjs';

const EXTERNAL_ROLE_CLAIMED_LABEL='tigeriq:role-claimed';

function issueLabelNames(issue){
  return (Array.isArray(issue?.labels)?issue.labels:[])
    .map((label)=>typeof label==='string'?label:String(label?.name||''))
    .filter(Boolean);
}

export function hasRoleClaimedLabel(issue){
  return issueLabelNames(issue).some((name)=>name.toLowerCase()===EXTERNAL_ROLE_CLAIMED_LABEL);
}

export function roleClaimedWorkerId(issue){
  for(const name of issueLabelNames(issue)){
    const match=String(name).toLowerCase().match(/^tigeriq:role-worker-(nv\d{2})$/);
    if(match)return match[1].toUpperCase();
  }
  return null;
}

const REPO = process.env.TIGERIQ_REPO || 'newsdayads/tigeriq-ai-lab';
const REGISTRY_ISSUE = 335;
const FETCH_TIMEOUT_MS = 5000;
const CACHE_MS = 3000;
const STALE_RESPONSE_MS = 30 * 60 * 1000;
const RUNTIME_POINTER_ISSUE = 1402;
const RUNTIME_FETCH_TIMEOUT_MS = 4500;
const POINTER_CACHE_MS = 10 * 60 * 1000;
const GITHUB_PROJECTION_CACHE_MS = Math.max(30 * 1000, Number(process.env.TIGERIQ_GITHUB_PROJECTION_CACHE_MS || 30 * 1000));
const DEPENDENCY_CACHE_MS = 60 * 1000;
const QUEUE_LIMIT = 20;
const RECENT_WORK_LIMIT = 50;
const RECENT_WORK_CACHE_MS = 5 * 60 * 1000;
const WORKING_HEARTBEAT_MAX_MS = 60 * 1000;
let pointerCache = { at: 0, url: null };
let cache = { at: 0, value: null };
let runtimeCache = { at: 0, value: null };
let githubProjectionCache = { at: 0, verifiedAt: null, data: null };
let recentWorkCache = { at: 0, data: null };
const dependencyCache = new Map();

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(body));
}

function repoParts() {
  const [owner, repo] = REPO.split('/');
  if (!owner || !repo) throw new Error('invalid_repo');
  return { owner, repo };
}

async function gh(path, fetchImpl = fetch) {
  const token = String(process.env.TIGERIQ_GITHUB_TOKEN || '').trim();
  return githubRequestJson(fetchImpl,`https://api.github.com${path}`,token,{freshMs:Math.min(GITHUB_PROJECTION_CACHE_MS,60*1000)});
}
export function projectionTransportStale(before = {}, after = {}) {
  return Number(after.staleHits || 0) > Number(before.staleHits || 0)
    || Number(after.backoffHits || 0) > Number(before.backoffHits || 0);
}

export async function ghAllPages(path, fetchImpl = fetch, maxPages = 10) {
  const rows = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const joiner = path.includes('?') ? '&' : '?';
    const pageArgs = /(?:^|[?&])per_page=/.test(path) ? 'page=' + page : 'per_page=100&page=' + page;
    const batch = await gh(path + joiner + pageArgs, fetchImpl);
    if (!Array.isArray(batch)) throw new Error('github_collection_invalid');
    rows.push(...batch);
    if (batch.length < 100) return { rows, complete: true };
  }
  return { rows, complete: false };
}


function cell(value = '') {
  return String(value).replace(/`/g, '').replace(/\*\*/g, '').trim();
}

function workerIdFromText(value = '') {
  const match = String(value).toUpperCase().match(/(?:^|[^A-Z0-9])(NV\d{2})(?=$|[^A-Z0-9])/);
  return match?.[1] || null;
}

function cleanJobTitle(value = '', workerId = '') {
  return String(value)
    .replace(new RegExp(`^\\[${workerId}\\]\\s*`, 'i'), '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export function parseRegistryWorkers(body = '') {
  const commandMap = new Map();
  for (const match of String(body).matchAll(/(?:`)?(\d+)↔(NV\d{2})(?:`)?/gi)) {
    commandMap.set(match[2].toUpperCase(), Number(match[1]));
  }

  const workers = [];
  const seen = new Set();
  for (const line of String(body).split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(cell);
    const directId = String(cells[0] || '').match(/^NV\d{2}$/i)?.[0]?.toUpperCase();
    const legacyId = String(cells[1] || '').match(/\bNV\d{2}\b/i)?.[0]?.toUpperCase();
    const employeeId = directId || legacyId;
    if (!employeeId || employeeId === 'NV00' || seen.has(employeeId)) continue;
    seen.add(employeeId);

    const label = directId ? (cells[1] || employeeId) : (cells[5] || cells[1] || employeeId);
    const adminState = directId ? (cells[2] || '') : (cells[6] || cells[4] || '');
    workers.push({
      employeeId,
      label,
      command: commandMap.get(employeeId) || null,
      adminState,
    });
  }
  return workers;
}

function registryFallback(worker) {
  const state = String(worker.adminState || '').toUpperCase();
  if (/PAUSED|RETIRED/.test(state)) {
    return { state: 'paused', status: 'TẠM NGƯNG', detail: 'Tạm ngưng theo Registry' };
  }
  if (/WAIT_KEY|BLOCKED/.test(state)) {
    return { state: 'blocked', status: 'BỊ CHẶN', detail: 'Không sẵn sàng theo Registry' };
  }
  if (/RATE_LIMIT|COOLDOWN|429/.test(state)) {
    return { state: 'waiting', status: 'CHỜ', detail: 'Đang chờ giới hạn tài nguyên' };
  }
  return { state: 'idle', status: 'RẢNH', detail: 'Không có việc GitHub đang chạy' };
}

function runUpdatedAt(run) {
  return Date.parse(run?.updated_at || run?.run_started_at || run?.created_at || 0) || 0;
}

function prUpdatedAt(pr) {
  return Date.parse(pr?.updated_at || pr?.created_at || 0) || 0;
}

function runWorker(run) {
  return workerIdFromText([run?.display_title, run?.name, run?.head_branch].filter(Boolean).join(' '));
}

function prWorker(pr) {
  return workerIdFromText([pr?.title, pr?.head?.ref].filter(Boolean).join(' '));
}

function statusForActiveRun(run) {
  const status = String(run?.status || '').toLowerCase();
  if (['queued', 'waiting', 'requested', 'pending'].includes(status)) return { state: 'waiting', status: 'CHỜ' };
  return { state: 'working', status: 'ĐANG LÀM' };
}

function progressForBranch(runs, branch) {
  const recent = runs.filter((run) => run?.head_branch === branch).sort((a, b) => runUpdatedAt(b) - runUpdatedAt(a));
  const latestByWorkflow = new Map();
  for (const run of recent) {
    const key = String(run?.name || run?.workflow_id || run?.id);
    if (!latestByWorkflow.has(key)) latestByWorkflow.set(key, run);
  }
  const batch = [...latestByWorkflow.values()];
  const passed = batch.filter((run) => run.status === 'completed' && run.conclusion === 'success').length;
  const failed = batch.filter((run) => run.status === 'completed' && !['success', 'skipped', 'neutral'].includes(String(run.conclusion || ''))).length;
  const active = batch.filter((run) => run.status !== 'completed').length;
  return {
    total: batch.length,
    passed,
    failed,
    active,
    percent: batch.length ? Math.round((passed / batch.length) * 100) : null,
    verified: true,
  };
}

function sourceFromRun(run, owner, repo) {
  const prNumber = Array.isArray(run?.pull_requests) ? run.pull_requests[0]?.number : null;
  if (prNumber) return { type: 'PR', number: prNumber, url: `https://github.com/${owner}/${repo}/pull/${prNumber}` };
  return { type: 'Workflow', number: run?.run_number || null, url: run?.html_url || null };
}

export async function buildLiveStatus(fetchImpl = fetch) {
  const { owner, repo } = repoParts();
  const [registry, runPayload, pulls] = await Promise.all([
    gh(`/repos/${owner}/${repo}/issues/${REGISTRY_ISSUE}`, fetchImpl),
    gh(`/repos/${owner}/${repo}/actions/runs?per_page=100`, fetchImpl),
    gh(`/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=100`, fetchImpl),
  ]);

  const workers = parseRegistryWorkers(registry.body || '');
  const runs = Array.isArray(runPayload?.workflow_runs) ? runPayload.workflow_runs : [];
  const openPulls = Array.isArray(pulls) ? pulls : [];

  const rows = workers.map((worker) => {
    const workerRuns = runs.filter((run) => runWorker(run) === worker.employeeId).sort((a, b) => runUpdatedAt(b) - runUpdatedAt(a));
    const activeRuns = workerRuns.filter((run) => run?.status !== 'completed');
    const workerPulls = openPulls.filter((pr) => prWorker(pr) === worker.employeeId).sort((a, b) => prUpdatedAt(b) - prUpdatedAt(a));
    const newestActive = activeRuns[0] || null;

    if (newestActive) {
      const state = statusForActiveRun(newestActive);
      const progress = progressForBranch(workerRuns, newestActive.head_branch);
      const source = sourceFromRun(newestActive, owner, repo);
      if (progress.failed > 0 && progress.active === 0) {
        state.state = 'blocked';
        state.status = 'BỊ CHẶN';
      }
      return {
        ...worker,
        ...state,
        job: cleanJobTitle(newestActive.display_title || newestActive.name || 'GitHub workflow', worker.employeeId),
        detail: progress.total
          ? `${progress.passed}/${progress.total} luồng đạt · ${progress.active} đang chạy${progress.failed ? ` · ${progress.failed} lỗi` : ''}`
          : 'Workflow đang chạy',
        updatedAt: newestActive.updated_at || newestActive.run_started_at || newestActive.created_at || null,
        progress,
        source,
      };
    }

    const openPr = workerPulls[0] || null;
    if (openPr) {
      return {
        ...worker,
        state: 'waiting',
        status: 'CHỜ',
        job: cleanJobTitle(openPr.title || 'Pull request đang mở', worker.employeeId),
        detail: `PR #${openPr.number} đang mở · chờ kiểm tra/gộp`,
        updatedAt: openPr.updated_at || openPr.created_at || null,
        progress: null,
        source: { type: 'PR', number: openPr.number, url: openPr.html_url || null },
      };
    }

    const fallback = registryFallback(worker);
    const latest = workerRuns[0] || null;
    return {
      ...worker,
      ...fallback,
      job: fallback.state === 'idle' ? 'Không có việc đang chạy' : fallback.detail,
      detail: fallback.detail,
      updatedAt: latest?.updated_at || registry.updated_at || null,
      progress: null,
      source: latest ? sourceFromRun(latest, owner, repo) : null,
    };
  });

  const order = { working: 0, blocked: 1, waiting: 2, idle: 3, paused: 4 };
  rows.sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9) || a.employeeId.localeCompare(b.employeeId));

  const summary = {
    working: rows.filter((row) => row.state === 'working').length,
    waiting: rows.filter((row) => row.state === 'waiting').length,
    blocked: rows.filter((row) => row.state === 'blocked').length,
    idle: rows.filter((row) => row.state === 'idle').length,
    paused: rows.filter((row) => row.state === 'paused').length,
    total: rows.length,
  };

  return buildWorkSections({
    ok: true,
    generatedAt: new Date().toISOString(),
    refreshSeconds: 10,
    source: {
      repository: REPO,
      registryIssue: REGISTRY_ISSUE,
      registryUpdatedAt: registry.updated_at || null,
    },
    summary,
    workers: rows.map(ownerFacingWorkRow),
    liveConnected: false,
  }, fetchImpl, { runs, pulls: openPulls });
}

export function parseRuntimeBridgeUrl(body = '') {
  const match = String(body).match(/^LIVE_STATUS_BRIDGE_URL=(https:\/\/\S+)$/mi);
  if (!match) throw new Error('runtime_bridge_pointer_missing');
  const url = new URL(match[1].trim());
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('runtime_bridge_pointer_invalid');
  const host = url.hostname.toLowerCase();
  if (!(host.endsWith('.trycloudflare.com') || host.endsWith('.ts.net'))) throw new Error('runtime_bridge_host_not_allowed');
  return url.origin;
}

function cleanText(value, max = 220) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function sanitizeRuntimeWorker(worker = {}) {
  const allowedStates = new Set(['working', 'waiting', 'blocked', 'idle', 'unknown', 'paused']);
  const employeeId = String(worker.employeeId || '').toUpperCase();
  if (!/^NV\d{2}$/.test(employeeId)) return null;
  const state = allowedStates.has(worker.state) ? worker.state : 'unknown';
  return {
    employeeId,
    label: cleanText(worker.label || employeeId, 80),
    kind: worker.kind === 'ui' ? 'ui' : 'api',
    state,
    status: cleanText(worker.status || 'CHƯA RÕ', 32),
    job: cleanText(worker.job || 'Không có dữ liệu việc hiện tại', 220),
    detail: cleanText(worker.detail || '', 220),
    updatedAt: typeof worker.updatedAt === 'string' ? worker.updatedAt.slice(0, 64) : null,
    heartbeatAt: typeof worker.heartbeatAt === 'string' ? worker.heartbeatAt.slice(0, 64) : null,
    currentJobId: worker.currentJobId ? cleanText(worker.currentJobId, 100) : null,
    prNumber: Number.isInteger(worker.prNumber) ? worker.prNumber : null,
    provider: worker.provider ? cleanText(worker.provider, 64) : null,
    model: worker.model ? cleanText(worker.model, 100) : null,
    cooldownUntil: typeof worker.cooldownUntil === 'string' ? worker.cooldownUntil.slice(0, 64) : null,
    lastError: worker.lastError ? cleanText(worker.lastError, 80) : null,
    source: 'PC01 live runtime',
  };
}

export function normalizeRuntimeWorkerActivity(worker, referenceAt = Date.now()) {
  if (!worker || worker.state !== 'working') return worker;
  const heartbeatAt = Date.parse(worker.heartbeatAt || '');
  const heartbeatAge = Number.isFinite(heartbeatAt) ? Math.max(0, referenceAt - heartbeatAt) : Number.POSITIVE_INFINITY;
  const hasCurrentJob = Boolean(worker.currentJobId);
  const heartbeatFresh = heartbeatAge <= WORKING_HEARTBEAT_MAX_MS;
  if (hasCurrentJob && heartbeatFresh) return worker;
  const reason = [
    !hasCurrentJob ? 'thiếu mã việc đang chạy' : '',
    !heartbeatFresh ? 'heartbeat quá 60 giây' : '',
  ].filter(Boolean).join(' · ');
  return {
    ...worker,
    state: 'unknown',
    status: 'CHƯA RÕ',
    detail: cleanText([worker.detail, reason].filter(Boolean).join(' · '), 220),
  };
}


export function parseIssueNumber(...values) {
  for (const value of values) {
    const text = String(value || '');
    const match = text.match(/(?:GH-|#|issues\/)(\d{1,6})(?!\d)/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function bodyValue(body, key) {
  const escaped = String(key).replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
  return String(body || '').match(new RegExp('^' + escaped + '=(.+)$', 'mi'))?.[1]?.trim() || '';
}

function firstBodyField(body, keys = []) {
  const wanted = new Set((Array.isArray(keys) ? keys : [keys]).map((key) => String(key || '').trim().toUpperCase()).filter(Boolean));
  if (!wanted.size) return null;
  for (const line of String(body || '').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/i);
    if (!match) continue;
    const key = String(match[1] || '').toUpperCase();
    if (!wanted.has(key)) continue;
    return { key, value: String(match[2] || '').trim() };
  }
  return null;
}

function firstBodyValue(body, keys = []) {
  return firstBodyField(body, keys)?.value || '';
}

function issueIsAppChromeControlPlane(issue) {
  const text = [issue?.title, issue?.body].filter(Boolean).join('\n');
  return /(?:\bAPP[-_ ]CHROME\b|apps\/chrome-controller\/|RESOURCE_SCOPE=APP_CHROME_)/i.test(text);
}

function bodyFlag(body, key, value = 'true') {
  return bodyValue(body, key).toLowerCase() === String(value).toLowerCase();
}

function safeEvidenceUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function safeEvidenceTimestamp(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function commentField(body, key) {
  const direct = bodyValue(body, key);
  if (direct) return direct;
  const wanted = String(key || '').trim().toUpperCase();
  for (const line of String(body || '').split(/\r?\n/)) {
    const parts = line.split('|');
    if (parts.length < 2) continue;
    if (String(parts.shift() || '').trim().toUpperCase() !== wanted) continue;
    return parts.join('|').trim();
  }
  return '';
}

export function parseClearedBlockerLifecycleComment(comment = {}) {
  const body = String(comment?.body || '');
  const state = (commentField(body, 'CURRENT_STATE') || commentField(body, 'STATE')).trim();
  const blocker = commentField(body, 'BLOCKER').trim();
  if (!state || !/^none(?:\b|\s)/i.test(blocker)) return null;
  return {
    state: state.toUpperCase(),
    blocker,
    blockerCleared: true,
    step: commentField(body, 'NEXT') || commentField(body, 'ACTION') || null,
    createdAt: comment?.created_at || comment?.updated_at || null,
  };
}

function statusFromLifecycleState(state = '') {
  const value = String(state || '').toUpperCase();
  if (!value) return null;
  if (/REBOOT_NEXT|WAIT|PENDING|HOLD/.test(value)) return 'WAITING';
  if (/REVIEW|VERIFY/.test(value)) return 'REVIEW';
  if (/BLOCKED|ERROR|FAILED/.test(value)) return 'BLOCKED';
  if (/INSTALL|UPDATE|APPLY|RUNNING|WORKING|IN_PROGRESS|EXECUTING/.test(value)) return 'WORKING';
  if (/READY|QUEUED/.test(value)) return 'QUEUED';
  return 'OPEN';
}

function issuePriority(issue) {
  const body = String(issue?.body || '');
  return bodyValue(body, 'PRIORITY').match(/^P[0-5]$/i)?.[0]?.toUpperCase()
    || String(issue?.title || '').match(/^\[(P[0-5])\]/i)?.[1]?.toUpperCase()
    || null;
}

function issueEmployeeId(issue) {
  const body = String(issue?.body || '');
  const authority = firstBodyField(body, [
    'MUTATION_OWNER',
    'ASSIGNED_EXECUTOR',
    'EXECUTOR',
    'TARGET_EMPLOYEE',
    'PRIMARY_EMPLOYEE',
    'IMPLEMENTER',
    'PREFERRED_REVIEWER',
    'REVIEWER',
  ]);
  if (authority) {
    const id = workerIdFromText(authority.value);
    if (id) return id;
    if (['MUTATION_OWNER','ASSIGNED_EXECUTOR','EXECUTOR'].includes(authority.key)) return null;
  }
  if (issueIsAppChromeControlPlane(issue)) return null;
  return workerIdFromText(issue?.title || '');
}

function issueIsTerminal(issue) {
  if (!issue || issue.pull_request || issue.state !== 'open') return true;
  const body = String(issue.body || '');
  const state = bodyValue(body, 'STATE').toUpperCase();
  return ['CLOSED', 'DONE', 'COMPLETED', 'SUPERSEDED', 'CANCELLED'].includes(state)
    || /^SUPERSEDED(?:_BY)?=/mi.test(body)
    || bodyFlag(body, 'TIGERIQ_EXECUTABLE', 'false');
}

function issueIsTerminalOrExcluded(issue) {
  if (issueIsTerminal(issue)) return true;
  const body = String(issue.body || '');
  const state = bodyValue(body, 'STATE').toUpperCase();
  return state === 'EXCLUDED' || bodyFlag(body, 'EXCLUDED') || bodyValue(body, 'AUTO_QUEUE').toUpperCase() === 'EXCLUDED';
}

export function parseRecentCompletedIssue(issue, now = Date.now()) {
  if (!issue || issue.pull_request || issue.state !== 'closed') return null;
  if (String(issue.state_reason || '').toLowerCase() === 'not_planned') return null;
  const body = String(issue.body || '');
  const acceptance = ownerAcceptancePolicy(body);
  if (acceptance.required && !acceptance.accepted) return null;
  const terminalState = bodyValue(body, 'STATE').toUpperCase();
  if (['CANCELLED', 'CANCELED', 'SUPERSEDED', 'NOT_PLANNED'].includes(terminalState)) return null;
  if (/^SUPERSEDED(?:_BY)?=/mi.test(body)) return null;
  const completedAt = issue.closed_at || issue.updated_at || null;
  const completedMs = Date.parse(completedAt || '');
  if (!Number.isFinite(completedMs) || completedMs > now) return null;
  const priority = issuePriority(issue);
  return {
    number: Number(issue.number),
    title: String(issue.title || ''),
    priority,
    effectivePriority: priority,
    sourcePriority: priority,
    employeeId: issueEmployeeId(issue),
    status: 'DONE',
    progressPercent: 100,
    progressSource: 'terminal',
    progressDetail: '5/5 gate',
    completedAt,
    updatedAt: completedAt,
    url: issue.html_url || null,
  };
}

async function recentCompletedWork(owner, repo, fetchImpl = fetch) {
  const now = Date.now();
  if (Array.isArray(recentWorkCache.data) && now - recentWorkCache.at < RECENT_WORK_CACHE_MS) {
    return recentWorkCache.data;
  }
  try {
    const issues = await gh('/repos/' + owner + '/' + repo + '/issues?state=closed&per_page=100&sort=updated&direction=desc', fetchImpl);
    const rows = (Array.isArray(issues) ? issues : [])
      .map((issue) => parseRecentCompletedIssue(issue, now))
      .filter(Boolean)
      .sort((a, b) => Date.parse(b.completedAt || 0) - Date.parse(a.completedAt || 0))
      .slice(0, RECENT_WORK_LIMIT);
    recentWorkCache = { at: now, data: rows };
    return rows;
  } catch {
    return Array.isArray(recentWorkCache.data) ? recentWorkCache.data : [];
  }
}

function queueWaitReason(issue) {
  const body = String(issue?.body || '');
  const state = bodyValue(body, 'STATE').toUpperCase();
  if (bodyFlag(body, 'OWNER_HOLD') || state === 'OWNER_HOLD' || state === 'MANUAL_HOLD') return 'OWNER_HOLD';
  if (state.includes('BLOCKED')) return bodyValue(body, 'BLOCKER') || bodyValue(body, 'BLOCKED_REASON') || state;
  if (/^(?:WAIT|PENDING)/.test(state)) return state;
  return null;
}

function queueDependencies(issue) {
  const raw = bodyValue(issue?.body || '', 'DEPENDS_ON');
  return [...new Set((raw.match(/#?\d+/g) || []).map((value) => Number(value.replace('#', ''))).filter(Boolean))].slice(0, 16);
}

export function parseQueueIssue(issue) {
  if (issueIsTerminalOrExcluded(issue)) return null;
  const coreSpec = parseExecutableIssue(issue);
  const codingSpec = parseCodingIssue(issue);
  if (!coreSpec && !codingSpec) return null;
  const terminalBlocked = hasTerminalBlockedLabel(issue);
  const roleClaimed = hasRoleClaimedLabel(issue);
  const holdReason = terminalBlocked ? 'TigerIQ terminal BLOCKED' : roleClaimed ? 'External role claim' : queueWaitReason(issue);
  const effectivePriority = codingSpec?.priority || coreSpec?.priority || issuePriority(issue) || 'P3';
  const sourcePriority = codingSpec?.sourcePriority || coreSpec?.sourcePriority || issuePriority(issue) || effectivePriority;
  return {
    number: Number(issue.number),
    title: String(issue.title || ''),
    priority: effectivePriority,
    effectivePriority,
    sourcePriority,
    ownerControlled: Boolean(codingSpec?.ownerControlled ?? coreSpec?.ownerControlled ?? false),
    ownerDirect: Boolean(codingSpec?.ownerDirect ?? coreSpec?.ownerDirect ?? bodyFlag(issue?.body || '', 'OWNER_DIRECT')),
    route: codingSpec ? 'CODING' : (coreSpec?.route || coreSpec?.dispatchLane || null),
    resourceScope: codingSpec?.scopeLease?.resourceScope || coreSpec?.resourceScope || bodyValue(issue?.body || '', 'RESOURCE_SCOPE') || null,
    status: terminalBlocked || (holdReason && /BLOCKED/.test(holdReason)) ? 'BLOCKED' : holdReason ? 'WAITING' : 'QUEUED',
    waitReason: holdReason,
    dependencies: codingSpec?.dependsOn || queueDependencies(issue),
    updatedAt: issue.updated_at || null,
    url: issue.html_url || null,
  };
}

function queuePriority(row) {
  return String(row?.effectivePriority || row?.priority || 'P3').toUpperCase();
}

export function queueRowEligibleNow(row) {
  return String(row?.status || '').toUpperCase() === 'QUEUED' && /^P[1-5]$/.test(queuePriority(row));
}

export function compareQueueRows(a, b) {
  const aEligible = queueRowEligibleNow(a);
  const bEligible = queueRowEligibleNow(b);
  if (aEligible !== bEligible) return aEligible ? -1 : 1;
  const rank = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };
  const aPriorityRank = !aEligible && queuePriority(a) === 'P0' ? 6 : (rank[queuePriority(a)] ?? rank.P3);
  const bPriorityRank = !bEligible && queuePriority(b) === 'P0' ? 6 : (rank[queuePriority(b)] ?? rank.P3);
  const delta = aPriorityRank - bPriorityRank;
  if (delta) return delta;
  if (aEligible && bEligible && Boolean(a?.ownerDirect) !== Boolean(b?.ownerDirect)) return a?.ownerDirect ? -1 : 1;
  const waitRank = { WAITING: 0, BLOCKED: 1, QUEUED: 2 };
  const waitDelta = (waitRank[String(a?.status || '').toUpperCase()] ?? 3) - (waitRank[String(b?.status || '').toUpperCase()] ?? 3);
  if (waitDelta) return waitDelta;
  return Number(a?.number || 0) - Number(b?.number || 0);
}

export function rankQueueRows(rows = []) {
  let dispatchRank = 0;
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const priority = queuePriority(row);
    const p0Waiting = String(row?.status || '').toUpperCase() === 'QUEUED' && priority === 'P0';
    const normalized = p0Waiting
      ? { ...row, status: 'WAITING', waitReason: row.waitReason || 'P0 chờ Owner/assignment' }
      : row;
    return normalized;
  }).sort(compareQueueRows).map((row) => {
    const eligibleNow = queueRowEligibleNow(row);
    return {
      ...row,
      eligibleNow,
      dispatchRank: eligibleNow ? ++dispatchRank : null,
    };
  });
}

function runtimeState(state) {
  if (state === 'working') return 'WORKING';
  if (state === 'blocked') return 'BLOCKED';
  if (state === 'waiting') return 'WAITING';
  return null;
}

function normalizedRuntimeTitle(value = '') {
  return String(value || '')
    .replace(/\s+\[(?:sửa lần|repair|retry)\s+\d+\]\s*$/iu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function projectExternalRoleClaims(base = {}, issues = []) {
  const claims = new Map();
  for (const issue of (Array.isArray(issues) ? issues : [])) {
    if (!issue || issue.pull_request || issue.state !== 'open' || !hasRoleClaimedLabel(issue)) continue;
    const workerId = roleClaimedWorkerId(issue);
    if (!/^NV(?:02|03|04)$/.test(String(workerId || ''))) continue;
    const previous = claims.get(workerId);
    const currentAt = Date.parse(issue.updated_at || '') || 0;
    const previousAt = Date.parse(previous?.updated_at || '') || 0;
    if (!previous || currentAt >= previousAt) claims.set(workerId, issue);
  }
  if (!claims.size) return base;

  const workers = (Array.isArray(base?.workers) ? base.workers : []).map((worker) => {
    const issue = claims.get(String(worker?.employeeId || '').toUpperCase());
    if (!issue) return worker;
    return {
      ...worker,
      state: 'working',
      status: 'ĐANG LÀM',
      job: `#${issue.number} - ${String(issue.title || '')}`,
      detail: 'Đã có nhân sự ngoài Core nhận việc · nhãn GitHub canonical',
      currentJobId: `GH-${issue.number}`,
      updatedAt: issue.updated_at || worker?.updatedAt || null,
      source: 'GitHub external role claim',
    };
  });
  const summary = {
    ...(base?.summary || {}),
    working: workers.filter((w) => w?.state === 'working').length,
    waiting: workers.filter((w) => w?.state === 'waiting').length,
    blocked: workers.filter((w) => w?.state === 'blocked').length,
    idle: workers.filter((w) => w?.state === 'idle').length,
    unknown: workers.filter((w) => w?.state === 'unknown').length,
    paused: workers.filter((w) => w?.state === 'paused').length,
    total: workers.length,
  };
  return { ...base, workers, summary };
}

export function runtimeWorkRows(workers = [], issues = []) {
  const rows = [];
  const seen = new Set();
  const openIssues = (Array.isArray(issues) ? issues : []).filter((issue) => issue && !issue.pull_request && issue.state === 'open');
  for (const worker of workers) {
    const status = runtimeState(worker?.state);
    if (!status) continue;
    let issueNumber = parseIssueNumber(worker?.currentJobId, worker?.job, worker?.detail);
    if (!issueNumber) {
      const jobTitle = normalizedRuntimeTitle(worker?.job);
      if (jobTitle) {
        const matches = openIssues.filter((issue) => normalizedRuntimeTitle(issue?.title) === jobTitle);
        if (matches.length === 1) issueNumber = Number(matches[0].number);
      }
    }
    if (!issueNumber) continue;
    const key = issueNumber + ':' + String(worker?.employeeId || '');
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      issueNumber,
      employeeId: worker.employeeId || null,
      runtimeStatus: status,
      currentStep: cleanText(worker.detail || worker.job || '', 220) || null,
      updatedAt: worker.heartbeatAt || worker.updatedAt || null,
      prNumber: Number.isInteger(worker.prNumber) ? worker.prNumber : null,
      source: 'PC01 live runtime',
    });
  }
  return rows;
}

function pullMentionsIssue(pull, issueNumber) {
  const n = String(issueNumber);
  const text = [pull?.title, pull?.body, pull?.head?.ref].filter(Boolean).join('\n');
  return new RegExp('(?:#|GH-|issue[-_/ ])' + n + '(?!\\d)', 'i').test(text);
}

function summarizeChecks(runs, pull) {
  if (!pull) return null;
  const branch = pull?.head?.ref;
  const branchRuns = (Array.isArray(runs) ? runs : []).filter((run) => run?.head_branch === branch);
  const latest = new Map();
  for (const run of branchRuns.sort((a, b) => runUpdatedAt(b) - runUpdatedAt(a))) {
    const key = String(run?.name || run?.workflow_id || run?.id);
    if (!latest.has(key)) latest.set(key, run);
  }
  const batch = [...latest.values()];
  if (!batch.length) return null;
  const active = batch.filter((run) => run?.status !== 'completed').length;
  const failed = batch.filter((run) => run?.status === 'completed' && !['success', 'neutral', 'skipped'].includes(String(run?.conclusion || ''))).length;
  const passed = batch.filter((run) => run?.status === 'completed' && run?.conclusion === 'success').length;
  return { state: failed ? 'LỖI' : active ? 'ĐANG CHẠY' : 'ĐẠT', passed, total: batch.length, active, failed };
}

async function dependencyStates(rows, owner, repo, fetchImpl) {
  const deps = [...new Set(rows.flatMap((row) => row.dependencies || []))];
  const results = new Map();
  const now = Date.now();
  await Promise.all(deps.map(async (number) => {
    const cached = dependencyCache.get(number);
    if (cached && now - cached.at < DEPENDENCY_CACHE_MS) {
      results.set(number, cached.value);
      return;
    }
    try {
      const dep = await gh('/repos/' + owner + '/' + repo + '/issues/' + number, fetchImpl);
      const value = { state: dep?.state || 'unknown', isPull: Boolean(dep?.pull_request) };
      dependencyCache.set(number, { at: now, value });
      results.set(number, value);
    } catch {
      const value = cached?.value || { state: 'unknown' };
      results.set(number, value);
    }
  }));
  return results;
}

function issueCanonicalState(issue) {
  const body = String(issue?.body || '');
  return firstBodyValue(body, ['CURRENT_STATE', 'STATE']).toUpperCase();
}

async function clearedBlockerLifecycleOverrides(issues, owner, repo, fetchImpl = fetch) {
  const candidates = (Array.isArray(issues) ? issues : [])
    .filter((issue) => hasTerminalBlockedLabel(issue) || /BLOCKED/.test(issueCanonicalState(issue)))
    .slice(0, 12);
  const pairs = await Promise.all(candidates.map(async (issue) => {
    try {
      const comments = await gh('/repos/' + owner + '/' + repo + '/issues/' + Number(issue.number) + '/comments?per_page=100', fetchImpl);
      const rows = Array.isArray(comments) ? comments : [];
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const parsed = parseClearedBlockerLifecycleComment(rows[i]);
        if (parsed) return [Number(issue.number), parsed];
      }
    } catch {
      // Keep canonical body/label truth if comment readback is unavailable.
    }
    return [Number(issue.number), null];
  }));
  return new Map(pairs.filter(([, value]) => value));
}

function ownerAcceptancePolicy(body = '') {
  const required = bodyFlag(body, 'OWNER_ACCEPTANCE_REQUIRED')
    || bodyFlag(body, 'NEW_CAPABILITY_OWNER_ACCEPTANCE_REQUIRED');
  const accepted = bodyFlag(body, 'OWNER_ACCEPTED')
    || bodyFlag(body, 'OWNER_ACCEPTANCE_ACCEPTED');
  return { required, accepted };
}

function ownerAcceptancePhase(phase = '') {
  return /(?:OWNER_REVIEW_REQUIRED|WAIT_OWNER(?:_ACCEPTANCE|_REVIEW)?|READY_OWNER(?:_ACCEPTANCE|_REVIEW)?|LIVE_VERIFIED|LIVE_ACCEPTANCE_PASS|READY_LIVE_ACCEPTANCE)/.test(String(phase || '').toUpperCase());
}

function issueDisplayOwner(issue) {
  const body = String(issue?.body || '');
  const classification = classifyOpenIssue(issue);
  if (classification.workKind === 'GOAL') return null;

  if (issueIsAppChromeControlPlane(issue)) {
    const authority = firstBodyField(body, ['MUTATION_OWNER', 'ASSIGNED_EXECUTOR', 'ACTIVE_OWNER']);
    const owner = String(authority?.value || '');
    if (/^(?:NV\d{2}|CODEX)$/i.test(owner)) return owner.toUpperCase();
    return null;
  }

  const employee = issueEmployeeId(issue);
  if (employee) return employee;
  const owner = firstBodyValue(body, ['MUTATION_OWNER', 'ACTIVE_OWNER']);
  if (/^(?:NV\d{2}|CODEX|AUTO)$/i.test(owner)) return owner.toUpperCase();
  return null;
}

export function classifyOpenIssue(issue) {
  const title = String(issue?.title || '');
  const body = String(issue?.body || '');
  const phase = issueCanonicalState(issue);
  const acceptance = ownerAcceptancePolicy(body);
  const ownerAcceptancePending = acceptance.required && !acceptance.accepted && ownerAcceptancePhase(phase);

  const systemReference = /\[(?:QUẢN TRỊ|REGISTRY|STATE|CENTRAL|TÀI NGUYÊN|POLICY|SOT)\]/i.test(title)
    || bodyFlag(body, 'CANONICAL_POLICY')
    || bodyFlag(body, 'REFERENCE_ONLY');

  const ownerGate = /(?:^|_)(?:BLOCKED_OWNER|WAIT_OWNER|OWNER_APPROVAL_REQUIRED|OWNER_GATE)(?:_|$)/.test(phase)
    || bodyFlag(body, 'OWNER_APPROVAL_REQUIRED')
    || bodyFlag(body, 'OWNER_GATE')
    || bodyFlag(body, 'OWNER_HOLD')
    || ownerAcceptancePending;

  const objective = /\[OWNER\]/i.test(title) && bodyFlag(body, 'TIGERIQ_EXECUTABLE', 'false') && !ownerGate;

  return {
    workKind: systemReference ? 'SYSTEM' : objective ? 'GOAL' : 'WORK',
    ownerGate,
    ownerApprovalRequired: acceptance.required && !acceptance.accepted,
    ownerAccepted: acceptance.accepted,
  };
}

function actionableStatus(issue, overlays = {}) {
  const body = String(issue?.body || '');
  const lifecycle = overlays.lifecycle || null;
  const phase = String(lifecycle?.state || issueCanonicalState(issue)).toUpperCase();
  const classification = classifyOpenIssue(issue);

  if (classification.workKind === 'SYSTEM') return 'SYSTEM';
  if (classification.ownerGate) return 'OWNER_GATE';

  const active = overlays.active || null;
  const queued = overlays.queued || null;
  const activeAt = Date.parse(active?.updatedAt || '') || 0;
  const queuedAt = Date.parse(queued?.updatedAt || '') || 0;
  const lifecycleAt = Date.parse(lifecycle?.createdAt || '') || 0;
  const issueAt = Date.parse(issue?.updated_at || '') || 0;
  const canonicalBlocked = /BLOCKED/.test(issueCanonicalState(issue));
  const terminalBlocked = hasTerminalBlockedLabel(issue);

  if (terminalBlocked && (canonicalBlocked || issueAt >= Math.max(activeAt, queuedAt, lifecycleAt))) return 'BLOCKED';
  if (active?.status && activeAt >= Math.max(queuedAt, lifecycleAt)) return String(active.status).toUpperCase();
  if (queued?.status && queuedAt >= Math.max(activeAt, lifecycleAt)) return String(queued.status).toUpperCase();
  if (lifecycle?.blockerCleared) return statusFromLifecycleState(phase) || 'OPEN';
  if (active?.status) return String(active.status).toUpperCase();
  if (queued?.status) return String(queued.status).toUpperCase();
  if (terminalBlocked) return 'BLOCKED';

  if (classification.workKind === 'GOAL') return 'GOAL';
  if (/(?:READY_(?:LIVE_)?ACCEPTANCE|READY_VERIFY|WAIT_VERIFY|LIVE_ACCEPTANCE)/.test(phase)) return 'VERIFY';
  if (/BLOCKED/.test(phase)) {
    return (bodyValue(body, 'BLOCKER') || bodyValue(body, 'BLOCKED_REASON')) ? 'BLOCKED' : 'UNKNOWN';
  }
  if (/(?:WAIT|PENDING|HOLD)/.test(phase)) return 'WAITING';
  if (/(?:REVIEW|VERIFY)/.test(phase)) return overlays.hasPull ? 'REVIEW' : 'UNKNOWN';
  if (/(?:WORKING|RUNNING|IN_PROGRESS|IMPLEMENT)/.test(phase)) return 'UNKNOWN';
  return 'OPEN';
}

export function progressForIssue(issue, status = 'OPEN', checks = null, hasPull = false) {
  const body = String(issue?.body || '');
  const source = bodyValue(body, 'PROGRESS_SOURCE').toUpperCase();
  const verified = bodyFlag(body, 'PROGRESS_VERIFIED')
    || source === 'VERIFIED'
    || source === 'VERIFIED_CHECKLIST';
  if (!verified) return { percent: null, source: 'none', detail: null };

  const explicitRaw = bodyValue(body, 'PROGRESS_PERCENT');
  if (/^\d{1,3}$/.test(explicitRaw)) {
    const explicit = Number(explicitRaw);
    if (explicit >= 0 && explicit <= 100) return { percent: explicit, source: 'explicit_verified', detail: 'PROGRESS_PERCENT · verified' };
  }

  const boxes = [...body.matchAll(/^\s*[-*]\s+\[([ xX])\]/gm)];
  if (boxes.length >= 2) {
    const done = boxes.filter((match) => /x/i.test(match[1])).length;
    return { percent: Math.round((done / boxes.length) * 100), source: 'checklist_verified', detail: done + '/' + boxes.length + ' checklist verified' };
  }

  return { percent: null, source: 'none', detail: null };
}

export function verifiedPortfolioProgress(rows = [], options = {}) {
  const scope = (Array.isArray(rows) ? rows : []).filter((row) => row && row.workKind === 'WORK');
  const verified = scope.filter((row) => ['explicit_verified','checklist_verified'].includes(String(row.progressSource || ''))
    && Number.isFinite(Number(row.progressPercent)));
  const scopeItems = scope.length;
  const verifiedItems = verified.length;
  const coveragePercent = scopeItems ? Math.round((verifiedItems / scopeItems) * 100) : null;
  if (options.complete === false) {
    return {
      percent: null,
      source: 'incomplete_enumeration',
      scopeItems,
      verifiedItems,
      coveragePercent,
    };
  }
  if (!scopeItems || verifiedItems !== scopeItems) {
    return {
      percent: null,
      source: 'incomplete_verified_coverage',
      scopeItems,
      verifiedItems,
      coveragePercent,
    };
  }
  const percent = Math.round(verified.reduce((sum, row) => sum + Math.max(0, Math.min(100, Number(row.progressPercent))), 0) / scopeItems);
  return {
    percent,
    source: 'verified_issue_average',
    scopeItems,
    verifiedItems,
    coveragePercent: 100,
  };
}

export function parseOpenWorkIssue(issue, overlays = {}) {
  if (!issue || issue.pull_request || issue.state !== 'open') return null;
  const number = Number(issue.number);
  if (!number) return null;
  const active = overlays.active || null;
  const queued = overlays.queued || null;
  const body = String(issue.body || '');
  const lifecycle = overlays.lifecycle || null;
  const classification = classifyOpenIssue(issue);
  const canonicalPhase = issueCanonicalState(issue);
  const phase = String(classification.ownerGate ? canonicalPhase : lifecycle?.state || canonicalPhase).toUpperCase();
  const status = actionableStatus(issue, overlays);

  const checks = classification.ownerGate ? null : active?.checks || null;
  const hasPull = classification.ownerGate ? false : Boolean(active?.prNumber || overlays.hasPull);
  const progress = classification.workKind === 'SYSTEM'
    ? { percent: null, source: 'none', detail: null }
    : progressForIssue(issue, status, checks, hasPull);
  const priority = issuePriority(issue);
  const currentStep = classification.ownerGate
    ? bodyValue(body, 'CURRENT_STEP') || 'Chờ anh Sơn duyệt'
    : active?.currentStep
      || queued?.waitReason
      || lifecycle?.step
      || bodyValue(body, 'CURRENT_STEP')
      || null;
  const latestCompletedStep = bodyValue(body, 'LAST_COMPLETED_STEP')
    || bodyValue(body, 'LATEST_COMPLETED_STEP')
    || bodyValue(body, 'LAST_DONE')
    || (checks?.state === 'ĐẠT' ? 'Kiểm tra PR đã đạt' : null);
  const nextStep = bodyValue(body, 'NEXT')
    || bodyValue(body, 'NEXT_ACTION')
    || (classification.ownerGate ? 'Anh Sơn kiểm tra và duyệt trên giao diện live' : null);
  const rawBlocker = bodyValue(body, 'BLOCKER') || bodyValue(body, 'BLOCKED_REASON') || '';
  const lifecycleAt = Date.parse(lifecycle?.createdAt || '') || 0;
  const issueAt = Date.parse(issue?.updated_at || '') || 0;
  const blockerBodyCurrent = !lifecycle?.blockerCleared || (lifecycleAt > 0 && issueAt > lifecycleAt);
  const blocker = status === 'BLOCKED' && blockerBodyCurrent && rawBlocker && !/^(?:NONE|NULL|N\/A|NO_BLOCKER|KHÔNG|KHONG)(?:\b|\s|$)/i.test(rawBlocker)
    ? rawBlocker
    : null;
  const activeEvidenceUrl = classification.ownerGate
    ? null
    : safeEvidenceUrl(active?.evidenceUrl)
      || safeEvidenceUrl(active?.prUrl)
      || null;
  const bodyEvidenceUrl = safeEvidenceUrl(bodyValue(body, 'EVIDENCE_URL'));
  const evidenceUrl = activeEvidenceUrl || bodyEvidenceUrl || null;
  const evidenceAt = activeEvidenceUrl
    ? safeEvidenceTimestamp(active?.updatedAt)
    : bodyEvidenceUrl
      ? safeEvidenceTimestamp(bodyValue(body, 'EVIDENCE_AT') || bodyValue(body, 'EVIDENCE_TIMESTAMP'))
      : null;

  return {
    number,
    title: String(issue.title || ''),
    priority,
    effectivePriority: priority,
    sourcePriority: priority,
    employeeId: issueIsAppChromeControlPlane(issue)
      ? issueDisplayOwner(issue)
      : classification.ownerGate
        ? issueDisplayOwner(issue)
        : active?.employeeId || queued?.targetWorker || issueDisplayOwner(issue),
    status,
    workKind: classification.workKind,
    ownerGate: classification.ownerGate,
    ownerApprovalRequired: classification.ownerApprovalRequired,
    ownerApprovalPending: classification.ownerGate,
    ownerAccepted: classification.ownerAccepted,
    currentState: phase || null,
    currentStep,
    latestCompletedStep,
    nextStep,
    blocker,
    evidenceUrl,
    evidenceAt,
    progressPercent: progress.percent,
    progressSource: progress.source,
    progressDetail: progress.detail,
    prNumber: classification.ownerGate ? null : active?.prNumber || null,
    prUrl: classification.ownerGate ? null : active?.prUrl || null,
    checks,
    updatedAt: classification.ownerGate
      ? issue.updated_at || null
      : active?.updatedAt || queued?.updatedAt || lifecycle?.createdAt || issue.updated_at || null,
    url: issue.html_url || null,
    meta: !priority,
  };
}

function githubActiveState(issue) {
  const body = String(issue?.body || '');
  const state = bodyValue(body, 'STATE').toUpperCase();
  const owner = bodyValue(body, 'MUTATION_OWNER') || bodyValue(body, 'ASSIGNED_EXECUTOR') || bodyValue(body, 'ACTIVE_OWNER');
  if (!owner) return null;
  if (['WORKING', 'RUNNING', 'IN_PROGRESS'].includes(state)) return { status: 'WORKING', owner };
  if (['REVIEW', 'VERIFY', 'REVIEWING'].includes(state)) return { status: 'REVIEW', owner };
  if (state.includes('BLOCKED')) return { status: 'BLOCKED', owner };
  if (state === 'WAITING') return { status: 'WAITING', owner };
  return null;
}

async function githubIssue(owner, repo, number, issueMap, fetchImpl) {
  if (issueMap.has(number)) return issueMap.get(number);
  try { return await gh('/repos/' + owner + '/' + repo + '/issues/' + number, fetchImpl); } catch { return null; }
}

function skillPromotionSnapshot() {
  try {
    const state = loadSkillPromotionState();
    return {
      state: 'AVAILABLE',
      summary: state.summary,
      entries: state.queue.entries.map((entry) => ({
        skillId: entry.skillId,
        status: entry.status,
        blocker: entry.blocker,
        nextCondition: entry.nextCondition,
        nextEligibleAt: entry.nextEligibleAt,
        promotionEligible: entry.promotionEligible,
      })),
    };
  } catch (error) {
    return {
      state: 'UNAVAILABLE',
      summary: { active: 0, validatedWaiting: 0, validatedBlocked: 0, canaryReady: 0, canaryRunning: 0, promotionEligible: 0, tracked: 0 },
      entries: [],
      reason: String(error instanceof Error ? error.message : error).slice(0, 120),
    };
  }
}

export async function buildWorkSections(base, fetchImpl = fetch, known = {}) {
  const { owner, repo } = repoParts();
  let projectionStale = false;
  let projectionReason = null;
  let issues;
  let pulls;
  let runPayload;
  let issuesComplete = true;
  try {
    const now = Date.now();
    const cached = githubProjectionCache.data && now - githubProjectionCache.at < GITHUB_PROJECTION_CACHE_MS;
    if (cached) {
      ({ issues, pulls, runPayload, issuesComplete } = githubProjectionCache.data);
      issuesComplete = issuesComplete === true;
      if (githubProjectionCache.data?.projectionStale === true) {
        projectionStale = true;
        projectionReason = githubProjectionCache.data?.projectionReason || 'GitHub cached projection marked stale';
      }
    } else {
      try {
        const transportBefore = githubTransportSnapshot();
        const [issuePages, openPullPayload, workflowPayload] = await Promise.all([
          ghAllPages('/repos/' + owner + '/' + repo + '/issues?state=open&per_page=100&sort=updated&direction=desc', fetchImpl),
          known.pulls ? Promise.resolve(known.pulls) : gh('/repos/' + owner + '/' + repo + '/pulls?state=open&sort=updated&direction=desc&per_page=100', fetchImpl),
          known.runs ? Promise.resolve({ workflow_runs: known.runs }) : gh('/repos/' + owner + '/' + repo + '/actions/runs?per_page=100', fetchImpl),
        ]);
        issues = issuePages.rows;
        issuesComplete = issuePages.complete;
        pulls = openPullPayload;
        runPayload = workflowPayload;
        const transportAfter = githubTransportSnapshot();
        if (projectionTransportStale(transportBefore, transportAfter)) {
          projectionStale = true;
          projectionReason = 'GitHub shared cache/backoff served stale data';
          issuesComplete = false;
        }
        githubProjectionCache = {
          at: now,
          verifiedAt: new Date().toISOString(),
          data: { issues, pulls, runPayload, issuesComplete, projectionStale, projectionReason },
        };
      } catch (error) {
        if (!githubProjectionCache.data) throw error;
        ({ issues, pulls, runPayload, issuesComplete } = githubProjectionCache.data);
        issuesComplete = issuesComplete !== false;
        projectionStale = true;
        projectionReason = String(error instanceof Error ? error.message : error).slice(0, 120);
      }
    }
    const openIssues = (Array.isArray(issues) ? issues : []).filter((issue) => !issue?.pull_request);
    base = projectExternalRoleClaims(base, openIssues);
    const openPulls = Array.isArray(pulls) ? pulls : [];
    const runs = Array.isArray(runPayload?.workflow_runs) ? runPayload.workflow_runs : [];
    const issueMap = new Map(openIssues.map((issue) => [Number(issue.number), issue]));
    const lifecycleOverrides = await clearedBlockerLifecycleOverrides(openIssues, owner, repo, fetchImpl);
    const activeRows = [];
    const activeNumbers = new Set();

    for (const row of runtimeWorkRows(base.workers || [], openIssues)) {
      const issue = await githubIssue(owner, repo, row.issueNumber, issueMap, fetchImpl);
      if (!issue || issue.pull_request || issue.state !== 'open') continue;
      activeNumbers.add(row.issueNumber);
      const pull = row.prNumber
        ? openPulls.find((item) => Number(item.number) === row.prNumber)
        : openPulls.find((item) => pullMentionsIssue(item, row.issueNumber));
      const checks = summarizeChecks(runs, pull);
      const liveStatus = checks?.state === 'LỖI' ? 'BLOCKED' : row.runtimeStatus === 'WAITING' && pull ? 'REVIEW' : row.runtimeStatus;
      activeRows.push({
        number: row.issueNumber,
        title: String(issue.title || ''),
        priority: issuePriority(issue),
        employeeId: row.employeeId,
        status: liveStatus,
        currentStep: row.currentStep,
        prNumber: pull?.number || row.prNumber || null,
        prUrl: pull?.html_url || null,
        checks,
        evidenceUrl: pull?.html_url || issue.html_url || null,
        updatedAt: row.updatedAt || issue.updated_at || null,
        url: issue.html_url || null,
        live: base.liveConnected === true,
      });
    }

    for (const pull of openPulls) {
      const issueNumber = parseIssueNumber(pull?.body, pull?.title, pull?.head?.ref);
      if (!issueNumber || activeNumbers.has(issueNumber)) continue;
      const issue = await githubIssue(owner, repo, issueNumber, issueMap, fetchImpl);
      if (!issue || issue.pull_request || issue.state !== 'open' || issueIsTerminal(issue)) continue;
      const checks = summarizeChecks(runs, pull);
      activeNumbers.add(issueNumber);
      activeRows.push({
        number: issueNumber,
        title: String(issue.title || ''),
        priority: issuePriority(issue),
        employeeId: bodyValue(issue.body || '', 'MUTATION_OWNER') || prWorker(pull) || null,
        status: checks?.state === 'LỖI' ? 'BLOCKED' : 'REVIEW',
        currentStep: checks?.state === 'LỖI' ? 'Kiểm tra PR đang lỗi'
          : checks?.state === 'ĐANG CHẠY' ? 'Đang chạy kiểm tra PR'
            : 'PR đang mở · chờ hoàn tất kiểm tra/rà soát',
        prNumber: pull.number || null,
        prUrl: pull.html_url || null,
        checks,
        evidenceUrl: pull.html_url || issue.html_url || null,
        updatedAt: pull.updated_at || issue.updated_at || null,
        url: issue.html_url || null,
        live: false,
      });
    }

    if (base.liveConnected !== true) {
      for (const issue of openIssues) {
        const issueNumber = Number(issue.number);
        if (!issueNumber || activeNumbers.has(issueNumber) || issueIsTerminal(issue)) continue;
        const explicit = githubActiveState(issue);
        if (!explicit) continue;
        const pull = openPulls.find((item) => pullMentionsIssue(item, issueNumber));
        if (!pull) continue;
        const checks = summarizeChecks(runs, pull);
        const status = checks?.state === 'LỖI' ? 'BLOCKED' : 'REVIEW';
        activeNumbers.add(issueNumber);
        activeRows.push({
          number: issueNumber,
          title: String(issue.title || ''),
          priority: issuePriority(issue),
          employeeId: explicit.owner,
          status,
          currentStep: checks?.state === 'LỖI' ? 'Kiểm tra PR đang lỗi'
            : checks?.state === 'ĐANG CHẠY' ? 'Đang chạy kiểm tra PR'
              : 'PR đang mở · chờ hoàn tất kiểm tra/rà soát',
          prNumber: pull?.number || null,
          prUrl: pull?.html_url || null,
          checks,
          evidenceUrl: pull?.html_url || issue.html_url || null,
          updatedAt: pull?.updated_at || issue.updated_at || null,
          url: issue.html_url || null,
          live: false,
        });
      }
    }

    if (!activeRows.length && base.liveConnected !== true) {
      for (const worker of base.workers || []) {
        const issueNumber = parseIssueNumber(worker?.job, worker?.source?.url);
        if (!issueNumber || activeNumbers.has(issueNumber) || !['working', 'waiting', 'blocked'].includes(worker?.state)) continue;
        const issue = issueMap.get(issueNumber);
        if (!issue || issue.state !== 'open') continue;
        const pull = openPulls.find((item) => Number(item.number) === Number(worker?.source?.number) || pullMentionsIssue(item, issueNumber));
        const checks = summarizeChecks(runs, pull);
        activeNumbers.add(issueNumber);
        activeRows.push({
          number: issueNumber,
          title: String(issue.title || ''),
          priority: issuePriority(issue),
          employeeId: worker.employeeId || null,
          status: worker.state === 'blocked' || checks?.state === 'LỖI' ? 'BLOCKED' : pull ? 'REVIEW' : worker.state === 'working' ? 'WORKING' : 'WAITING',
          currentStep: cleanText(worker.detail || worker.job || '', 220) || null,
          prNumber: pull?.number || null,
          prUrl: pull?.html_url || null,
          checks,
          evidenceUrl: pull?.html_url || issue.html_url || null,
          updatedAt: worker.updatedAt || issue.updated_at || null,
          url: issue.html_url || null,
          live: false,
        });
      }
    }

    const recentWork = await recentCompletedWork(owner, repo, fetchImpl);
    const specs = openIssues.map(parseQueueIssue).filter(Boolean).filter((row) => !activeNumbers.has(row.number));
    const depStates = await dependencyStates(specs, owner, repo, fetchImpl);
    const resolvedQueue = specs.map((row) => {
      if (row.status !== 'QUEUED') return row;
      const waiting = (row.dependencies || []).filter((number) => {
        const dep = depStates.get(number);
        return !dep || dep.state !== 'closed' || dep.isPull === true;
      });
      if (!waiting.length) return row;
      const unknown = waiting.filter((number) => depStates.get(number)?.state === 'unknown');
      return {
        ...row,
        status: unknown.length ? 'BLOCKED' : 'WAITING',
        waitReason: unknown.length
          ? 'Chưa xác minh dependency ' + unknown.map((n) => '#' + n).join(', ')
          : 'Chờ ' + waiting.map((n) => '#' + n).join(', '),
      };
    });
    const rankedQueue = rankQueueRows(resolvedQueue);
    const nextQueue = rankedQueue.slice(0, QUEUE_LIMIT);
    const nextExecutable = rankedQueue.find((row) => row.eligibleNow) || null;

    const activeMap = new Map(activeRows.map((row) => [Number(row.number), row]));
    const queueMap = new Map(rankedQueue.map((row) => [Number(row.number), row]));
    const openWork = openIssues.map((issue) => parseOpenWorkIssue(issue, {
      active: activeMap.get(Number(issue.number)) || null,
      queued: queueMap.get(Number(issue.number)) || null,
      lifecycle: lifecycleOverrides.get(Number(issue.number)) || null,
      hasPull: openPulls.some((pull) => pullMentionsIssue(pull, Number(issue.number))),
    })).filter(Boolean).sort((a, b) => {
      const actionRank = {
        OWNER_GATE: 0,
        WORKING: 1,
        REVIEW: 2,
        VERIFY: 3,
        QUEUED: 4,
        BLOCKED: 5,
        WAITING: 6,
        OPEN: 7,
        GOAL: 8,
        SYSTEM: 9,
      };
      const sa = actionRank[a.status] ?? 8;
      const sb = actionRank[b.status] ?? 8;
      if (sa !== sb) return sa - sb;
      const priorityRank = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };
      const pa = priorityRank[a.priority] ?? 9;
      const pb = priorityRank[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      return Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0) || b.number - a.number;
    });

    const actionable = openWork.filter((row) => row.workKind === 'WORK');
    const openSummary = {
      open: openWork.length,
      actionable: actionable.length,
      owner: actionable.filter((row) => row.status === 'OWNER_GATE').length,
      running: actionable.filter((row) => row.status === 'WORKING').length,
      review: actionable.filter((row) => ['REVIEW','VERIFY'].includes(row.status)).length,
      blocked: actionable.filter((row) => row.status === 'BLOCKED').length,
      queued: actionable.filter((row) => row.status === 'QUEUED').length,
      unknown: actionable.filter((row) => row.status === 'UNKNOWN').length,
      waiting: actionable.filter((row) => ['QUEUED','WAITING','BLOCKED','UNKNOWN'].includes(row.status)).length,
      system: openWork.filter((row) => row.workKind === 'SYSTEM').length,
      done: recentWork.length,
    };
    const portfolioProgress = verifiedPortfolioProgress(actionable, { complete: issuesComplete === true && !projectionStale });

    return {
      ...base,
      skillPromotion: skillPromotionSnapshot(),
      openWork: openWork.map(ownerFacingWorkRow),
      openSummary,
      portfolioProgress,
      activeWork: activeRows.sort((a, b) => compareQueueRows(
        { ownerDirect: false, priority: a.priority || 'P2', number: a.number },
        { ownerDirect: false, priority: b.priority || 'P2', number: b.number },
      )).map(ownerFacingWorkRow),
      nextQueue: nextQueue.map(ownerFacingWorkRow),
      nextQueueTotal: rankedQueue.length,
      nextExecutable: nextExecutable ? ownerFacingWorkRow(nextExecutable) : null,
      recentWork: recentWork.map(ownerFacingWorkRow),
      workProjection: {
        mode: projectionStale ? 'stale-cache' : (base.liveConnected ? 'pc01-live+github' : 'github-fallback'),
        queuePolicy: 'ELIGIBLE_P1>P2>P3>P4>P5;OWNER_DIRECT_TIEBREAK;WAITING_UNRANKED',
        source: projectionStale ? 'GitHub snapshot xác minh gần nhất' : 'PC01 runtime when available + GitHub canonical parsers',
        verifiedAt: githubProjectionCache.verifiedAt,
        stale: projectionStale,
        reason: projectionReason,
        queueLimit: QUEUE_LIMIT,
        nextExecutableIssue: nextExecutable?.number || null,
        openIssueEnumerationComplete: issuesComplete === true && !projectionStale,
      },
    };
  } catch (error) {
    return {
      ...base,
      skillPromotion: skillPromotionSnapshot(),
      openWork: [],
      openSummary: { open: 0, running: 0, waiting: 0, done: 0 },
      activeWork: [],
      nextQueue: [],
      nextQueueTotal: 0,
      recentWork: [],
      workProjection: {
        mode: 'unavailable',
        queuePolicy: 'ELIGIBLE_P1>P2>P3>P4>P5;OWNER_DIRECT_TIEBREAK;WAITING_UNRANKED',
        source: 'GitHub unavailable',
        reason: String(error instanceof Error ? error.message : error).slice(0, 120),
        queueLimit: QUEUE_LIMIT,
      },
    };
  }
}

export function sanitizeRuntimePayload(payload) {
  if (!payload || payload.ok !== true || !Array.isArray(payload.workers)) throw new Error('runtime_bridge_payload_invalid');
  const referenceAt = Date.parse(payload.generatedAt || '') || Date.now();
  const workers = payload.workers.map(sanitizeRuntimeWorker).filter(Boolean).map((worker) => normalizeRuntimeWorkerActivity(worker, referenceAt)).map(ownerFacingWorkRow);
  const summary = {
    working: workers.filter((w) => w.state === 'working').length,
    waiting: workers.filter((w) => w.state === 'waiting').length,
    blocked: workers.filter((w) => w.state === 'blocked').length,
    idle: workers.filter((w) => w.state === 'idle').length,
    unknown: workers.filter((w) => w.state === 'unknown').length,
    paused: workers.filter((w) => w.state === 'paused').length,
    total: workers.length,
  };
  return {
    ok: true,
    liveConnected: true,
    mode: 'pc01-live',
    authority: 'PC01 live runtime',
    generatedAt: typeof payload.generatedAt === 'string' ? payload.generatedAt.slice(0, 64) : new Date().toISOString(),
    refreshSeconds: 5,
    source: {
      runtime: 'PC01 Core + Coding Lane',
      core: payload.source?.core === true,
      coding: payload.source?.coding === true,
      uiAutopilot: payload.source?.uiAutopilot === true,
    },
    summary,
    workers,
    activeWork: runtimeWorkRows(workers).map(ownerFacingWorkRow),
    nextQueue: [],
    nextQueueTotal: 0,
    recentWork: [],
  };
}

async function resolveRuntimeBridge(fetchImpl = fetch) {
  const now = Date.now();
  if (pointerCache.url && now - pointerCache.at < POINTER_CACHE_MS) return pointerCache.url;
  const { owner, repo } = repoParts();
  const issue = await gh(`/repos/${owner}/${repo}/issues/${RUNTIME_POINTER_ISSUE}`, fetchImpl);
  const url = parseRuntimeBridgeUrl(issue.body || '');
  pointerCache = { at: now, url };
  return url;
}

async function fetchRuntimeBridgePayload(base, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RUNTIME_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${base}/status`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`runtime_bridge_http_${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchPc01Runtime(fetchImpl = fetch) {
  let base = await resolveRuntimeBridge(fetchImpl);
  try {
    return sanitizeRuntimePayload(await fetchRuntimeBridgePayload(base, fetchImpl));
  } catch (error) {
    const reason = String(error instanceof Error ? error.message : error);
    if (!/^runtime_bridge_(?:http_|pointer_|payload_|fetch|timeout)/i.test(reason) && !/AbortError/i.test(reason)) throw error;
    pointerCache = { at: 0, url: null };
    const refreshedBase = await resolveRuntimeBridge(fetchImpl);
    if (refreshedBase === base && !/^runtime_bridge_http_530$/i.test(reason)) throw error;
    base = refreshedBase;
    return sanitizeRuntimePayload(await fetchRuntimeBridgePayload(base, fetchImpl));
  }
}

export async function fetchPc01Live(fetchImpl = fetch) {
  const now = Date.now();
  let runtime = runtimeCache.value && now - runtimeCache.at < CACHE_MS ? runtimeCache.value : null;
  if (!runtime) {
    runtime = await fetchPc01Runtime(fetchImpl);
    runtimeCache = { at: now, value: runtime };
  }
  return buildWorkSections(runtime, fetchImpl);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  const now = Date.now();
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const workforceOnly = req.query?.scope === 'workforce' || requestUrl.searchParams.get('scope') === 'workforce';

  if (workforceOnly) {
    if (runtimeCache.value && now - runtimeCache.at < CACHE_MS) return json(res, 200, runtimeCache.value);
    try {
      const value = await fetchPc01Runtime();
      runtimeCache = { at: now, value };
      return json(res, 200, value);
    } catch (error) {
      const reason = String(error instanceof Error ? error.message : error).slice(0, 120);
      if (runtimeCache.value && now - runtimeCache.at < STALE_RESPONSE_MS) {
        return json(res, 200, {
          ...runtimeCache.value,
          liveConnected: false,
          mode: 'stale-cache',
          authority: 'Dữ liệu runtime xác minh gần nhất',
          staleAll: true,
          staleAt: runtimeCache.value.generatedAt || null,
          liveReason: reason,
        });
      }
      return json(res, 200, {
        ok: false,
        liveConnected: false,
        mode: 'unavailable',
        authority: 'Không có nguồn runtime',
        generatedAt: new Date().toISOString(),
        reason,
        summary: { working: 0, waiting: 0, blocked: 0, idle: 0, unknown: 0, paused: 0, total: 0 },
        workers: [],
      });
    }
  }

  if (cache.value && now - cache.at < CACHE_MS) return json(res, 200, cache.value);

  let liveError = null;
  try {
    const value = await fetchPc01Live();
    cache = { at: now, value };
    return json(res, 200, value);
  } catch (error) {
    liveError = String(error instanceof Error ? error.message : error).slice(0, 120);
  }

  try {
    const value = await buildLiveStatus();
    value.liveConnected = false;
    value.mode = 'github-fallback';
    value.authority = 'GitHub/Registry dự phòng';
    value.refreshSeconds = 5;
    value.liveReason = liveError;
    value.staleAll = false;
    cache = { at: now, value };
    return json(res, 200, value);
  } catch (error) {
    if (cache.value && now - cache.at < STALE_RESPONSE_MS) {
      const value = {
        ...cache.value,
        liveConnected: false,
        mode: 'stale-cache',
        authority: 'Dữ liệu xác minh gần nhất',
        staleAll: true,
        staleAt: cache.value.generatedAt || null,
        liveReason: liveError || String(error instanceof Error ? error.message : error).slice(0, 120),
      };
      return json(res, 200, value);
    }
    return json(res, 200, {
      ok: false,
      liveConnected: false,
      mode: 'unavailable',
      authority: 'Không có nguồn live',
      generatedAt: new Date().toISOString(),
      reason: localizeOwnerFacingText(liveError || String(error instanceof Error ? error.message : error).slice(0, 120)),
      summary: { working: 0, waiting: 0, blocked: 0, idle: 0, unknown: 0, paused: 0, total: 0 },
      workers: [],
      activeWork: [],
      nextQueue: [],
      nextQueueTotal: 0,
      recentWork: [],
      workProjection: {
        mode: 'unavailable',
        queuePolicy: 'ELIGIBLE_P1>P2>P3>P4>P5;OWNER_DIRECT_TIEBREAK;WAITING_UNRANKED',
        source: 'Không có nguồn xác minh',
      },
    });
  }
}
