import { timingSafeEqual, randomUUID, createHash } from 'node:crypto';
import { decideWithChief } from './chief.mjs';
import { isOwnerAuthorized } from './owner-auth.mjs';

const REPO = process.env.TIGERIQ_REPO || 'newsdayads/tigeriq-ai-lab';
const COMMAND_SECRET = process.env.TIGERIQ_COMMAND_SECRET || '';
const GITHUB_TOKEN = process.env.TIGERIQ_GITHUB_TOKEN || '';
const CANARY_ISSUE = Number(process.env.TIGERIQ_PC01_CANARY_ISSUE || '58');
const ALLOWED_PRIORITIES = new Set(['P0', 'P1', 'P2']);
const workCreationLocks = new Map();

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.end(JSON.stringify(body));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function authorizedByServerSecret(req) {
  if (!COMMAND_SECRET) return false;
  return safeEqual(req.headers?.['x-tigeriq-secret'], COMMAND_SECRET);
}

function looksLikeBrowser(req) {
  const headers = req?.headers || {};
  return Boolean(headers.origin || headers.referer || headers['sec-fetch-site'] || headers['sec-fetch-mode']);
}

async function writeCredential(req) {
  const ownerSession = isOwnerAuthorized(req);
  const internalSecret = authorizedByServerSecret(req) && !looksLikeBrowser(req);
  if (GITHUB_TOKEN && (ownerSession || internalSecret)) {
    return { token: GITHUB_TOKEN, mode: ownerSession ? 'owner-session' : 'server-secret' };
  }
  const error = new Error('github_authorization_required');
  error.status = 401;
  throw error;
}

function readCredential() {
  return GITHUB_TOKEN || '';
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += part.length;
    if (total > 64_000) throw new Error('payload_too_large');
    chunks.push(part);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function repoParts() {
  const [owner, repo] = REPO.split('/');
  if (!owner || !repo) throw new Error('invalid_repo');
  return { owner, repo };
}

async function gh(path, init = {}, token = '') {
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'tigeriq-ai-vercel-control',
    ...(init.headers || {}),
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com${path}`, { ...init, headers });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text.slice(0, 500) }; }
  if (!response.ok) {
    const error = new Error(`github_${response.status}`);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

export function normalizeInstruction(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function workFingerprint(instruction) {
  return createHash('sha256').update(normalizeInstruction(instruction)).digest('hex').slice(0, 24);
}

const LIFECYCLE_MARKERS = new Map([
  ['TIGERIQ_PC01_CLAIMED', 'claimed'],
  ['TIGERIQ_JOB_CLAIMED', 'claimed'],
  ['TIGERIQ_COMMAND_CLAIMED', 'claimed'],
  ['TIGERIQ_PC01_DONE', 'completed'],
  ['TIGERIQ_PC01_RESULT', 'completed'],
  ['TIGERIQ_JOB_DONE', 'completed'],
  ['TIGERIQ_JOB_RESULT', 'completed'],
  ['TIGERIQ_COMMAND_RESULT', 'completed'],
  ['TIGERIQ_PC01_FAILED', 'failed'],
  ['TIGERIQ_JOB_FAILED', 'failed'],
  ['TIGERIQ_COMMAND_FAILED', 'failed'],
]);
const GATE_MARKERS = new Set(['REVIEW_PASS', 'JUDGE_PASS']);

function exactMarkerLines(body) {
  return String(body || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function lifecycleMarker(line) {
  const first = String(line || '').split(/\s+/, 1)[0];
  return LIFECYCLE_MARKERS.has(first) ? first : null;
}

function eventSort(a, b) {
  if (a.timestamp !== null && b.timestamp !== null && a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  if (a.timestamp !== null && b.timestamp === null) return -1;
  if (a.timestamp === null && b.timestamp !== null) return 1;
  if (a.commentIndex !== b.commentIndex) return a.commentIndex - b.commentIndex;
  return a.lineIndex - b.lineIndex;
}

function isAfterOrSame(a, b) {
  return eventSort(a, b) >= 0;
}

export function lifecycleEvents(comments = []) {
  const rows = Array.isArray(comments) ? comments : [];
  const events = [];
  rows.forEach((comment, commentIndex) => {
    const body = typeof comment === 'string' ? comment : String(comment?.body || '');
    const createdAt = typeof comment === 'string' ? null : (comment?.created_at || comment?.createdAt || null);
    const timestamp = createdAt ? Date.parse(createdAt) : Number.NaN;
    exactMarkerLines(body).forEach((line, lineIndex) => {
      const marker = lifecycleMarker(line);
      if (!marker) return;
      events.push({
        stage: LIFECYCLE_MARKERS.get(marker), marker, line, createdAt,
        timestamp: Number.isFinite(timestamp) ? timestamp : null,
        commentIndex, lineIndex,
      });
    });
  });
  return events.sort(eventSort);
}

function gateEvents(comments = []) {
  const rows = Array.isArray(comments) ? comments : [];
  const events = [];
  rows.forEach((comment, commentIndex) => {
    const body = typeof comment === 'string' ? comment : String(comment?.body || '');
    const createdAt = typeof comment === 'string' ? null : (comment?.created_at || comment?.createdAt || null);
    const timestamp = createdAt ? Date.parse(createdAt) : Number.NaN;
    exactMarkerLines(body).forEach((line, lineIndex) => {
      if (!GATE_MARKERS.has(line)) return;
      events.push({ marker: line, createdAt, timestamp: Number.isFinite(timestamp) ? timestamp : null, commentIndex, lineIndex });
    });
  });
  return events.sort(eventSort);
}

function resultHasEvidence(comments, resultEvent) {
  if (!resultEvent) return false;
  const marker = resultEvent.marker;
  const inline = String(resultEvent.line || '').slice(marker.length).trim();
  if (inline) return true;
  const comment = (Array.isArray(comments) ? comments : [])[resultEvent.commentIndex];
  const body = typeof comment === 'string' ? comment : String(comment?.body || '');
  return exactMarkerLines(body).some((line, index) => {
    if (index === resultEvent.lineIndex) return false;
    if (GATE_MARKERS.has(line)) return false;
    if (lifecycleMarker(line)) return false;
    if (/^```/.test(line)) return false;
    return line.length > 0;
  });
}

export function latestLifecycleStage(comments = []) {
  const events = lifecycleEvents(comments);
  return events.length ? events[events.length - 1].stage : null;
}

export function issueEvidenceSummary(comments = []) {
  const rows = Array.isArray(comments) ? comments : [];
  const events = lifecycleEvents(rows);
  const gates = gateEvents(rows);
  const stages = new Set(events.map((event) => event.stage));
  const latestResult = [...events].reverse().find((event) => event.stage === 'completed') || null;
  const reviewEvent = latestResult ? gates.find((event) => event.marker === 'REVIEW_PASS' && isAfterOrSame(event, latestResult)) || null : null;
  const judgeEvent = reviewEvent ? gates.find((event) => event.marker === 'JUDGE_PASS' && isAfterOrSame(event, reviewEvent)) || null : null;
  const resultEvidence = resultHasEvidence(rows, latestResult);
  const latestStage = events.length ? events[events.length - 1].stage : null;
  const reviewPass = Boolean(reviewEvent);
  const judgePass = Boolean(judgeEvent);
  return {
    claimed: stages.has('claimed'),
    result: stages.has('completed'),
    resultEvidence,
    failed: stages.has('failed'),
    reviewPass,
    judgePass,
    completionReady: Boolean(latestStage === 'completed' && latestResult && resultEvidence && reviewPass && judgePass),
  };
}

export function issueStage(issue, comments = []) {
  const state = String(issue?.state || 'open');
  const reason = String(issue?.state_reason || '');
  if (state === 'closed' && ['not_planned', 'duplicate'].includes(reason)) return 'cancelled';
  const proof = issueEvidenceSummary(comments);
  const latest = latestLifecycleStage(comments);
  if (latest === 'failed') return 'failed';
  if (proof.completionReady) return 'completed';
  if (proof.result && !proof.resultEvidence) return state === 'closed' ? 'closed_unverified' : 'evidence_pending';
  if (proof.result && !proof.reviewPass) return state === 'closed' ? 'closed_unverified' : 'review_pending';
  if (proof.result && proof.reviewPass && !proof.judgePass) return state === 'closed' ? 'closed_unverified' : 'gate_pending';
  if (state === 'closed') return 'closed_unverified';
  if (latest === 'claimed') return 'claimed';
  return 'queued';
}

export function issuePriority(issue) {
  const body = String(issue?.body || '');
  const field = body.match(/(?:^|\n)## Priority\s*\n\s*(P[012])\s*(?:\n|$)/i);
  if (field) return field[1].toUpperCase();
  const title = String(issue?.title || '');
  const titleMatch = title.match(/(?:^|[^A-Z0-9])(P[012])(?:[^A-Z0-9]|$)/i);
  return titleMatch ? titleMatch[1].toUpperCase() : null;
}

export function issueType(issue) {
  const body = String(issue?.body || '');
  if (body.includes('TIGERIQ_COMMAND_V1')) return 'command';
  if (body.includes('TIGERIQ_JOB_V1')) return 'work-order';
  return 'unknown';
}

export function workItemSummary(issue, comments = [], nowMs = Date.now()) {
  const stage = issueStage(issue, comments);
  const evidence = issueEvidenceSummary(comments);
  const updatedAt = issue?.updated_at || issue?.updatedAt || null;
  const updatedMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const ageMinutes = Number.isFinite(updatedMs) ? Math.max(0, Math.floor((nowMs - updatedMs) / 60000)) : null;
  const stale = ['queued', 'claimed', 'evidence_pending', 'review_pending', 'gate_pending', 'closed_unverified'].includes(stage)
    && ageMinutes !== null && ageMinutes >= 30;
  return {
    number: Number(issue?.number || 0), title: String(issue?.title || ''), state: String(issue?.state || 'unknown'),
    stateReason: issue?.state_reason || null, stage, priority: issuePriority(issue), type: issueType(issue),
    url: issue?.html_url || issue?.url || null, updatedAt, ageMinutes, stale, evidence,
  };
}

async function findDuplicateOpenWorkOrder(fingerprint, token) {
  const { owner, repo } = repoParts();
  const issues = await gh(`/repos/${owner}/${repo}/issues?state=open&per_page=100&sort=updated&direction=desc`, {}, token);
  return issues.find((item) => !item.pull_request && typeof item.body === 'string'
    && item.body.includes('TIGERIQ_JOB_V1') && item.body.includes(`## Fingerprint\n${fingerprint}`)) || null;
}

async function statusSnapshot(token = '') {
  const { owner, repo } = repoParts();
  const [repoInfo, openIssues, canary, comments] = await Promise.all([
    gh(`/repos/${owner}/${repo}`, {}, token),
    gh(`/repos/${owner}/${repo}/issues?state=open&per_page=50&sort=updated&direction=desc`, {}, token),
    gh(`/repos/${owner}/${repo}/issues/${CANARY_ISSUE}`, {}, token).catch(() => null),
    gh(`/repos/${owner}/${repo}/issues/${CANARY_ISSUE}/comments?per_page=100`, {}, token).catch(() => []),
  ]);
  const jobs = openIssues.filter((item) => !item.pull_request && typeof item.body === 'string'
    && (item.body.includes('TIGERIQ_JOB_V1') || item.body.includes('TIGERIQ_COMMAND_V1')))
    .slice(0, 20).map((item) => ({
      number: item.number, title: item.title, state: item.state, updatedAt: item.updated_at,
      url: item.html_url, type: item.body.includes('TIGERIQ_COMMAND_V1') ? 'command' : 'work-order',
    }));
  const canaryStage = issueStage(canary, comments);
  const pc01 = canaryStage === 'completed' ? 'online' : canaryStage === 'claimed' ? 'working' : canaryStage === 'failed' ? 'degraded' : 'offline';
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    controlPlane: {
      vercel: 'online', github: 'online', repository: repoInfo.full_name,
      serverWriteConfigured: Boolean(GITHUB_TOKEN), clientTokenSupported: false,
      browserWriteRequiresOwner: true, chiefOfStaff: 'gpt', workOrderDedupe: true,
      canaryDedupe: true, workOrderStatusTracking: true, workOrderLifecycleEvidence: true,
      completionRequiresResultEvidenceReviewGate: true, explicitDispatch: true, workBoard: true,
    },
    execution: { pc01, openclaw: 'unknown', ollama: 'unknown', canaryIssue: CANARY_ISSUE, canaryState: canary?.state || 'unknown' },
    queue: { count: jobs.length, jobs },
  };
}

async function workBoard(token = '') {
  const { owner, repo } = repoParts();
  const [issues, comments] = await Promise.all([
    gh(`/repos/${owner}/${repo}/issues?state=all&per_page=50&sort=updated&direction=desc`, {}, token),
    gh(`/repos/${owner}/${repo}/issues/comments?per_page=100&sort=updated&direction=desc`, {}, token).catch(() => []),
  ]);
  const commentsByIssue = new Map();
  for (const comment of Array.isArray(comments) ? comments : []) {
    const match = String(comment?.issue_url || '').match(/\/issues\/(\d+)$/);
    if (!match) continue;
    const number = Number(match[1]);
    const rows = commentsByIssue.get(number) || [];
    rows.push(comment);
    commentsByIssue.set(number, rows);
  }
  const markerIssues = (Array.isArray(issues) ? issues : []).filter((item) => !item.pull_request && typeof item.body === 'string'
    && (item.body.includes('TIGERIQ_JOB_V1') || item.body.includes('TIGERIQ_COMMAND_V1'))).slice(0, 20);
  const nowMs = Date.now();
  const items = markerIssues.map((item) => workItemSummary(item, commentsByIssue.get(item.number) || [], nowMs));
  const count = (stage) => items.filter((item) => item.stage === stage).length;
  return {
    ok: true, generatedAt: new Date(nowMs).toISOString(),
    policy: { staleMinutes: 30, issueLimit: 20, commentLimit: 100, mutation: false, completionEvidenceGated: true },
    summary: {
      total: items.length,
      active: items.filter((item) => !['completed', 'failed', 'cancelled'].includes(item.stage)).length,
      queued: count('queued'), claimed: count('claimed'), completed: count('completed'), failed: count('failed'),
      cancelled: count('cancelled'), closedUnverified: count('closed_unverified'),
      evidencePending: count('evidence_pending'), reviewPending: count('review_pending'), gatePending: count('gate_pending'),
      stale: items.filter((item) => item.stale).length,
    },
    items,
  };
}

async function githubIdentity(token) {
  if (!token) {
    const error = new Error('github_authorization_required');
    error.status = 401;
    throw error;
  }
  const { owner, repo } = repoParts();
  const [user, repoInfo] = await Promise.all([gh('/user', {}, token), gh(`/repos/${owner}/${repo}`, {}, token)]);
  return { ok: true, login: user.login, repository: repoInfo.full_name, repositoryAccess: true };
}

async function createWorkOrderUnlocked({ instruction, priority, source, governance, fingerprint }, token) {
  const duplicate = await findDuplicateOpenWorkOrder(fingerprint, token);
  if (duplicate) {
    return { ok: true, deduplicated: true, fingerprint, requestId: null,
      issue: { number: duplicate.number, url: duplicate.html_url, title: duplicate.title } };
  }
  const id = randomUUID();
  const titleText = instruction.replace(/\s+/g, ' ').slice(0, 72);
  const body = [
    'TIGERIQ_JOB_V1', '', '## Instruction', instruction, '', '## Priority', priority, '', '## Source', source,
    '', '## Request ID', id, '', '## Fingerprint', fingerprint, '', '## Governance', governance,
  ].join('\n');
  const { owner, repo } = repoParts();
  const issue = await gh(`/repos/${owner}/${repo}/issues`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: `[${priority}] [TigerIQ AI] ${titleText}`, body }),
  }, token);
  return { ok: true, deduplicated: false, fingerprint, requestId: id,
    issue: { number: issue.number, url: issue.html_url, title: issue.title } };
}

async function createWorkOrder(payload, token) {
  const instruction = String(payload.instruction || payload.message || '').trim();
  const priority = String(payload.priority || 'P1').toUpperCase();
  const source = payload.source === 'vercel-explicit-dispatch' ? 'vercel-explicit-dispatch' : 'vercel-chat-chief-of-staff';
  const governance = source === 'vercel-explicit-dispatch'
    ? 'Owner explicitly dispatched this instruction from TigerIQ AI Web Control. Execution still requires normal TigerIQ evidence/review/gate.'
    : 'Chief of Staff classified this as an explicit execution request. Execution still requires normal TigerIQ evidence/review/gate.';
  if (instruction.length < 3 || instruction.length > 4000) throw new Error('invalid_instruction');
  if (!ALLOWED_PRIORITIES.has(priority)) throw new Error('invalid_priority');
  const fingerprint = workFingerprint(instruction);
  const pending = workCreationLocks.get(fingerprint);
  if (pending) {
    const result = await pending;
    return { ...result, deduplicated: true, requestId: null };
  }
  const promise = createWorkOrderUnlocked({ instruction, priority, source, governance, fingerprint }, token);
  workCreationLocks.set(fingerprint, promise);
  try { return await promise; }
  finally { if (workCreationLocks.get(fingerprint) === promise) workCreationLocks.delete(fingerprint); }
}

async function workOrderStatus(payload, token = '') {
  const number = Number(payload.issueNumber || payload.number || 0);
  if (!Number.isInteger(number) || number <= 0) throw new Error('invalid_issue_number');
  const { owner, repo } = repoParts();
  const [issue, comments] = await Promise.all([
    gh(`/repos/${owner}/${repo}/issues/${number}`, {}, token),
    gh(`/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`, {}, token).catch(() => []),
  ]);
  if (issue.pull_request || typeof issue.body !== 'string' || !(issue.body.includes('TIGERIQ_JOB_V1') || issue.body.includes('TIGERIQ_COMMAND_V1'))) {
    const error = new Error('invalid_work_order_issue');
    error.status = 400;
    throw error;
  }
  return { ok: true, issue: { ...workItemSummary(issue, comments), comments: Array.isArray(comments) ? comments.length : 0 } };
}

async function canonicalCanary(token) {
  const result = await workOrderStatus({ issueNumber: CANARY_ISSUE }, token);
  return { ok: true, deduplicated: true, canonical: true, idempotencyKey: `canonical-issue-${CANARY_ISSUE}`, issue: result.issue };
}

function formatStatusReply(snapshot) {
  const pc = snapshot.execution.pc01 === 'online' ? 'trực tuyến'
    : snapshot.execution.pc01 === 'working' ? 'đang làm việc'
      : snapshot.execution.pc01 === 'degraded' ? 'có lỗi' : 'chưa xác minh';
  return `Vercel: trực tuyến · GitHub: trực tuyến · PC01: ${pc} · OpenClaw: chưa xác định · Ollama: chưa xác định · Hàng đợi: ${snapshot.queue.count} công việc.`;
}

export default async function handler(req, res) {
  try {
    const readToken = readCredential();
    if (req.method === 'GET') return json(res, 200, await statusSnapshot(readToken));
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    const payload = await readBody(req);
    const operation = String(payload.operation || 'status');
    if (operation === 'status') return json(res, 200, await statusSnapshot(readToken));
    if (operation === 'whoami') return json(res, 200, await githubIdentity((await writeCredential(req)).token));
    if (operation === 'work-order-status') return json(res, 200, await workOrderStatus(payload, readToken));
    if (operation === 'work-board') return json(res, 200, await workBoard(readToken));

    if (operation === 'chat') {
      const decision = await decideWithChief({ message: payload.message, history: payload.history });
      if (decision.mode === 'status') {
        const snapshot = await statusSnapshot(readToken);
        return json(res, 200, { ok: true, mode: 'status', reply: formatStatusReply(snapshot), snapshot,
          modelUsed: decision.modelUsed, providerUsed: decision.providerUsed, usage: decision.usage });
      }
      if (decision.mode === 'reply' || decision.mode === 'clarify') {
        return json(res, 200, { ok: true, mode: decision.mode, reply: decision.reply,
          modelUsed: decision.modelUsed, providerUsed: decision.providerUsed, usage: decision.usage });
      }
      const credential = await writeCredential(req);
      const result = await createWorkOrder({ instruction: decision.instruction, priority: decision.priority }, credential.token);
      const workReply = result.deduplicated
        ? `${decision.reply}\n\nCông việc này đang được theo dõi ở #${result.issue.number}; em không tạo bản trùng.`
        : `${decision.reply}\n\nĐã tạo công việc #${result.issue.number}. Em sẽ theo dõi execution → review → gate → evidence.`;
      return json(res, result.deduplicated ? 200 : 201, { ...result, mode: 'work-order', reply: workReply,
        modelUsed: decision.modelUsed, providerUsed: decision.providerUsed, usage: decision.usage });
    }

    if (operation === 'work-order') {
      const result = await createWorkOrder({ ...payload, source: 'vercel-explicit-dispatch' }, (await writeCredential(req)).token);
      return json(res, result.deduplicated ? 200 : 201, result);
    }
    if (operation === 'canary') return json(res, 200, await canonicalCanary((await writeCredential(req)).token));
    return json(res, 400, { error: 'unsupported_operation' });
  } catch (error) {
    const name = error instanceof Error ? error.message : String(error);
    let status = Number(error?.status) || 502;
    if (name === 'payload_too_large') status = 413;
    else if (name.startsWith('invalid_')) status = 400;
    else if (name === 'github_authorization_required' || name === 'github_401') status = 401;
    else if (name === 'github_403') status = 403;
    return json(res, status, { error: name, details: error?.details?.message || error?.details || undefined });
  }
}
