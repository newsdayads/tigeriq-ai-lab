import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { decideWithChief } from './chief.mjs';
import { executionRequirementForInstruction } from './execution-routing.mjs';
import { isOwnerAuthorized } from './owner-auth.mjs';
import legacyHandler, {
  issuePriority,
  issueType,
  workFingerprint,
  workItemSummary as legacyWorkItemSummary,
} from './control-legacy.mjs';
import {
  cloudExecutorEnabled,
  cloudWorkforceDescriptor,
  executeCloudTask,
  judgeCloudTask,
  reviewCloudTask,
  signServerGateComment,
  verifyServerGateComment,
} from './cloud-workforce.mjs';

export const config = { maxDuration: 60 };

const REPO = process.env.TIGERIQ_REPO || 'newsdayads/tigeriq-ai-lab';
const GITHUB_TOKEN = String(process.env.TIGERIQ_GITHUB_TOKEN || '').trim();
const COMMAND_SECRET = String(process.env.TIGERIQ_COMMAND_SECRET || '').trim();
const SERVER_GATE_SLUG = 'tigeriq-server-attested';
const ALLOWED_PRIORITIES = new Set(['P0', 'P1', 'P2']);
const WORK_LOCK_PREFIX = 'tigeriq-work-lock-';
const WORK_LOCK_TTL_MS = 10 * 60 * 1000;
const EXPECTED_EVIDENCE = 'Concrete executor result answering the instruction; a matching sha256 EVIDENCE_REF bound to result/evidence text; independent REVIEW_PASS; final JUDGE_PASS; no unsupported external-action claim.';

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

function looksLikeBrowser(req) {
  const headers = req?.headers || {};
  return Boolean(headers.origin || headers.referer || headers['sec-fetch-site'] || headers['sec-fetch-mode']);
}

function authorizedByServerSecret(req) {
  return Boolean(COMMAND_SECRET && safeEqual(req.headers?.['x-tigeriq-secret'], COMMAND_SECRET));
}

function writeCredential(req) {
  const ownerSession = isOwnerAuthorized(req);
  const internalSecret = authorizedByServerSecret(req) && !looksLikeBrowser(req);
  if (GITHUB_TOKEN && (ownerSession || internalSecret)) {
    return { token: GITHUB_TOKEN, mode: ownerSession ? 'owner-session' : 'server-secret' };
  }
  const error = new Error('github_authorization_required');
  error.status = 401;
  throw error;
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
    'user-agent': 'tigeriq-single-door',
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

async function rawBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return Buffer.from(JSON.stringify(req.body));
  }
  if (typeof req.body === 'string') return Buffer.from(req.body);
  const chunks = [];
  let total = 0;
  if (req?.[Symbol.asyncIterator]) {
    for await (const chunk of req) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += part.length;
      if (total > 64_000) throw new Error('payload_too_large');
      chunks.push(part);
    }
  }
  return Buffer.concat(chunks);
}

function parsePayload(raw) {
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); } catch {
    const error = new Error('invalid_json');
    error.status = 400;
    throw error;
  }
}

function clonedReq(req, payloadOrRaw) {
  const raw = Buffer.isBuffer(payloadOrRaw) ? payloadOrRaw : Buffer.from(JSON.stringify(payloadOrRaw || {}));
  return {
    ...req,
    body: undefined,
    async *[Symbol.asyncIterator]() { if (raw.length) yield raw; },
  };
}

function memoryRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
    end(value = '') { this.body = String(value); },
  };
}

async function legacyJson(req, payload) {
  const res = memoryRes();
  await legacyHandler(clonedReq(req, payload), res);
  let body = {};
  try { body = res.body ? JSON.parse(res.body) : {}; } catch { body = { raw: res.body }; }
  return { status: res.statusCode, body, headers: res.headers };
}

function decorateServerGates(comments = []) {
  return (Array.isArray(comments) ? comments : []).map((comment) => {
    if (!comment || typeof comment === 'string' || !verifyServerGateComment(comment.body)) return comment;
    return { ...comment, performed_via_github_app: { ...(comment.performed_via_github_app || {}), slug: SERVER_GATE_SLUG } };
  });
}

async function findCanonicalWorkOrder(fingerprint, token) {
  const { owner, repo } = repoParts();
  const issues = await gh(`/repos/${owner}/${repo}/issues?state=all&per_page=100&sort=updated&direction=desc`, {}, token);
  return (Array.isArray(issues) ? issues : []).find((item) => !item.pull_request && typeof item.body === 'string'
    && item.body.includes('TIGERIQ_JOB_V1') && item.body.includes(`## Fingerprint\n${fingerprint}`)) || null;
}

function distributedLockName(fingerprint) {
  return `${WORK_LOCK_PREFIX}${fingerprint}`;
}

function lockCreatedAt(label) {
  const match = String(label?.description || '').match(/^TigerIQ distributed work lock (\d{13})$/);
  return match ? Number(match[1]) : null;
}

async function acquireDistributedWorkLock(fingerprint, token, retried = false) {
  const { owner, repo } = repoParts();
  const name = distributedLockName(fingerprint);
  try {
    await gh(`/repos/${owner}/${repo}/labels`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, color: 'ededed', description: `TigerIQ distributed work lock ${Date.now()}` }),
    }, token);
    return { name, acquired: true };
  } catch (error) {
    if (error?.status !== 422) throw error;
    const existing = await gh(`/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`, {}, token).catch(() => null);
    const createdAt = lockCreatedAt(existing);
    if (!retried && createdAt && Date.now() - createdAt > WORK_LOCK_TTL_MS) {
      await gh(`/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' }, token).catch(() => null);
      return acquireDistributedWorkLock(fingerprint, token, true);
    }
    return { name, acquired: false };
  }
}

async function releaseDistributedWorkLock(name, token) {
  const { owner, repo } = repoParts();
  await gh(`/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' }, token).catch(() => null);
}

async function waitForCanonical(fingerprint, token) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const duplicate = await findCanonicalWorkOrder(fingerprint, token);
    if (duplicate) return duplicate;
    if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function postIssueComment(issueNumber, body, token) {
  const { owner, repo } = repoParts();
  return gh(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }),
  }, token);
}

async function closeIssue(issueNumber, token) {
  const { owner, repo } = repoParts();
  return gh(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
  }, token);
}

function evidenceRefFor(input) {
  const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return `sha256:${digest}`;
}

function conciseError(error) {
  return String(error instanceof Error ? error.message : error).replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 120) || 'unknown_error';
}

async function runCloudPipeline({ issue, instruction, fingerprint }, token) {
  const issueNumber = Number(issue.number);
  const runId = randomUUID();
  const workforce = cloudWorkforceDescriptor();
  await postIssueComment(issueNumber, [
    'TIGERIQ_JOB_CLAIMED',
    `RUN_ID ${runId}`,
    'EXECUTOR vercel-serverless',
    `EXECUTOR_GATEWAY ${workforce.gateway}`,
    'PC01_REQUIRED false',
  ].join('\n'), token);

  try {
    const execution = await executeCloudTask({ instruction, expectedEvidence: EXPECTED_EVIDENCE });
    if (execution.status !== 'completed') {
      await postIssueComment(issueNumber, [
        'TIGERIQ_JOB_FAILED',
        `RUN_ID ${runId}`,
        'FAILURE_KIND bounded_executor_blocked',
        `BLOCKER ${execution.blocker || 'required capability is outside non-mutating cloud scope'}`,
        `MODEL ${execution.modelUsed}`,
        `PROVIDER ${execution.providerUsed || workforce.gateway}`,
      ].join('\n'), token);
      return { stage: 'failed', runId, blocker: execution.blocker || 'bounded_executor_blocked', modelUsed: execution.modelUsed };
    }

    const evidenceRef = evidenceRefFor({
      version: 'TIGERIQ_CLOUD_EVIDENCE_V1', fingerprint, instruction,
      expectedEvidence: EXPECTED_EVIDENCE, result: execution.result, evidenceSummary: execution.evidenceSummary,
    });
    await postIssueComment(issueNumber, [
      'TIGERIQ_JOB_RESULT',
      `EVIDENCE_REF ${evidenceRef}`,
      `RUN_ID ${runId}`,
      `EXECUTOR_MODEL ${execution.modelUsed}`,
      `EXECUTOR_PROVIDER ${execution.providerUsed || workforce.gateway}`,
      '', '## Expected Evidence', EXPECTED_EVIDENCE,
      '', '## Result', execution.result || '(empty result)',
      '', '## Evidence Summary', execution.evidenceSummary || '(empty evidence summary)',
    ].join('\n'), token);

    const review = await reviewCloudTask({
      instruction, expectedEvidence: EXPECTED_EVIDENCE,
      result: execution.result, evidenceSummary: execution.evidenceSummary,
    });
    if (!review.pass) {
      await postIssueComment(issueNumber, [
        'TIGERIQ_JOB_FAILED', `RUN_ID ${runId}`, 'FAILURE_KIND independent_review_failed',
        `EVIDENCE_REF ${evidenceRef}`, `REVIEW_MODEL ${review.modelUsed}`, `REVIEW_PROVIDER ${review.providerUsed || workforce.gateway}`, '', review.rationale || 'Reviewer did not pass.',
      ].join('\n'), token);
      return { stage: 'failed', runId, evidenceRef, blocker: 'independent_review_failed', review };
    }
    const reviewBody = signServerGateComment([
      'REVIEW_PASS', `EVIDENCE_REF ${evidenceRef}`, `RUN_ID ${runId}`,
      'REVIEW_ROLE independent-cloud-reviewer', `REVIEW_MODEL ${review.modelUsed}`, `REVIEW_PROVIDER ${review.providerUsed || workforce.gateway}`,
      '', review.rationale || 'Independent reviewer passed.',
    ].join('\n'));
    await postIssueComment(issueNumber, reviewBody, token);

    const judge = await judgeCloudTask({
      instruction, expectedEvidence: EXPECTED_EVIDENCE,
      result: execution.result, evidenceSummary: execution.evidenceSummary, review,
    });
    if (!judge.pass) {
      await postIssueComment(issueNumber, [
        'TIGERIQ_JOB_FAILED', `RUN_ID ${runId}`, 'FAILURE_KIND judge_failed',
        `EVIDENCE_REF ${evidenceRef}`, `JUDGE_MODEL ${judge.modelUsed}`, `JUDGE_PROVIDER ${judge.providerUsed || workforce.gateway}`, '', judge.rationale || 'Judge did not pass.',
      ].join('\n'), token);
      return { stage: 'failed', runId, evidenceRef, blocker: 'judge_failed', review, judge };
    }
    const judgeBody = signServerGateComment([
      'JUDGE_PASS', `EVIDENCE_REF ${evidenceRef}`, `RUN_ID ${runId}`,
      'JUDGE_ROLE cloud-judge', `JUDGE_MODEL ${judge.modelUsed}`, `JUDGE_PROVIDER ${judge.providerUsed || workforce.gateway}`,
      '', judge.rationale || 'Judge passed.',
    ].join('\n'));
    await postIssueComment(issueNumber, judgeBody, token);
    await closeIssue(issueNumber, token);
    return {
      stage: 'completed', runId, evidenceRef,
      executorModel: execution.modelUsed, reviewerModel: review.modelUsed, judgeModel: judge.modelUsed,
    };
  } catch (error) {
    const name = conciseError(error);
    await postIssueComment(issueNumber, [
      'TIGERIQ_JOB_FAILED', `RUN_ID ${runId}`, 'FAILURE_KIND cloud_pipeline_error', `ERROR ${name}`,
    ].join('\n'), token).catch(() => null);
    return { stage: 'failed', runId, blocker: name };
  }
}

function validateWorkOrder(payload = {}) {
  const instruction = String(payload.instruction || '').trim().slice(0, 6000);
  if (instruction.length < 3) {
    const error = new Error('invalid_instruction');
    error.status = 400;
    throw error;
  }
  const requestedPriority = String(payload.priority || 'P1').toUpperCase();
  const priority = ALLOWED_PRIORITIES.has(requestedPriority) ? requestedPriority : 'P1';
  return { instruction, priority, fingerprint: workFingerprint(instruction) };
}

async function createCanonicalWorkOrder(payload, token) {
  const { instruction, priority, fingerprint } = validateWorkOrder(payload);
  const routing = executionRequirementForInstruction(instruction);
  const duplicate = await findCanonicalWorkOrder(fingerprint, token);
  if (duplicate) {
    return {
      ok: true, deduplicated: true, fingerprint, requestId: null, routing,
      issue: { number: duplicate.number, url: duplicate.html_url, title: duplicate.title, state: duplicate.state },
      execution: { stage: duplicate.state === 'closed' ? 'canonical-reused' : 'existing' },
    };
  }

  const lock = await acquireDistributedWorkLock(fingerprint, token);
  if (!lock.acquired) {
    const raced = await waitForCanonical(fingerprint, token);
    if (raced) {
      return {
        ok: true, deduplicated: true, fingerprint, requestId: null, routing,
        issue: { number: raced.number, url: raced.html_url, title: raced.title, state: raced.state },
        execution: { stage: raced.state === 'closed' ? 'canonical-reused' : 'existing' },
      };
    }
    const error = new Error('work_order_inflight');
    error.status = 409;
    throw error;
  }

  try {
    const afterLock = await findCanonicalWorkOrder(fingerprint, token);
    if (afterLock) {
      return {
        ok: true, deduplicated: true, fingerprint, requestId: null, routing,
        issue: { number: afterLock.number, url: afterLock.html_url, title: afterLock.title, state: afterLock.state },
        execution: { stage: afterLock.state === 'closed' ? 'canonical-reused' : 'existing' },
      };
    }

    const requestId = randomUUID();
    const titleText = instruction.replace(/\s+/g, ' ').slice(0, 72);
    const workforce = cloudWorkforceDescriptor();
    const issueSource = routing.source || String(payload.source || 'vercel-explicit-dispatch');
    const executorDescription = routing.cloudExecutorAllowed
      ? `${workforce.runtime} / ${workforce.gateway} / executor=${workforce.executorModel} / PC01_REQUIRED=false`
      : `${routing.kind === 'pc01-runtime' ? 'PC01 secure worker/runtime only' : 'physical device runtime only'} / PC01_REQUIRED=${String(routing.pc01Required)} / CLOUD_EXECUTOR_ALLOWED=false`;
    const governance = routing.cloudExecutorAllowed
      ? 'Owner-authenticated; evidence-gated; no MAIN/Production mutation; fail closed on unsupported external action.'
      : `Owner-authenticated; physical/runtime evidence required; cloud executor blocked before model invocation; reason=${routing.reason}; no MAIN/Production mutation.`;
    const body = [
      'TIGERIQ_JOB_V1', '', '## Instruction', instruction, '', '## Priority', priority,
      '', '## Source', issueSource,
      '', '## Request ID', requestId, '', '## Fingerprint', fingerprint,
      '', '## Expected Evidence', EXPECTED_EVIDENCE,
      '', '## Executor', executorDescription,
      '', '## Governance', governance,
    ].join('\n');
    const { owner, repo } = repoParts();
    const issue = await gh(`/repos/${owner}/${repo}/issues`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: `[${priority}] [TigerIQ AI] ${titleText}`, body }),
    }, token);

    const execution = !routing.cloudExecutorAllowed
      ? { stage: 'physical-runtime-required', reason: routing.reason, executionKind: routing.kind, pc01Required: routing.pc01Required }
      : cloudExecutorEnabled()
        ? await runCloudPipeline({ issue, instruction, fingerprint }, token)
        : { stage: 'queued', reason: 'cloud_executor_disabled_outside_vercel' };
    return {
      ok: true, deduplicated: false, fingerprint, requestId, routing,
      issue: { number: issue.number, url: issue.html_url, title: issue.title, state: execution.stage === 'completed' ? 'closed' : 'open' },
      execution,
    };
  } finally {
    await releaseDistributedWorkLock(lock.name, token);
  }
}

async function workOrderStatus(payload, token) {
  const number = Number(payload.issueNumber || payload.issue || 0);
  if (!Number.isInteger(number) || number <= 0) {
    const error = new Error('invalid_issue_number');
    error.status = 400;
    throw error;
  }
  const { owner, repo } = repoParts();
  const [issue, comments] = await Promise.all([
    gh(`/repos/${owner}/${repo}/issues/${number}`, {}, token),
    gh(`/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`, {}, token).catch(() => []),
  ]);
  return { ok: true, issue: { ...legacyWorkItemSummary(issue, decorateServerGates(comments)), comments: Array.isArray(comments) ? comments.length : 0 } };
}

async function workBoard(token) {
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
    rows.push(comment); commentsByIssue.set(number, rows);
  }
  const nowMs = Date.now();
  const items = (Array.isArray(issues) ? issues : [])
    .filter((item) => !item.pull_request && issueType(item) !== 'unknown')
    .slice(0, 20)
    .map((item) => legacyWorkItemSummary(item, decorateServerGates(commentsByIssue.get(item.number) || []), nowMs));
  const terminal = new Set(['completed', 'failed', 'cancelled']);
  const count = (stage) => items.filter((item) => item.stage === stage).length;
  return {
    ok: true, generatedAt: new Date(nowMs).toISOString(),
    policy: { staleMinutes: 30, issueLimit: 20, commentLimit: 100, mutation: false, completionEvidenceGated: true, evidenceContract: 'EVIDENCE_REF' },
    cloudWorkforce: cloudWorkforceDescriptor(),
    summary: {
      total: items.length, active: items.filter((item) => !terminal.has(item.stage)).length,
      queued: count('queued'), claimed: count('claimed'), completed: count('completed'), failed: count('failed'),
      cancelled: count('cancelled'), closedUnverified: count('closed_unverified'), evidencePending: count('evidence_pending'),
      reviewPending: count('review_pending'), gatePending: count('gate_pending'), stale: items.filter((item) => item.stale).length,
    },
    items,
  };
}

function formatStatusReply(snapshot) {
  const count = Number(snapshot?.queue?.count || 0);
  return `Vercel: trực tuyến · GitHub: trực tuyến · Cloud executor: ${cloudExecutorEnabled() ? 'sẵn sàng phần mềm' : 'tắt'} · PC01 chỉ bắt buộc cho việc cần runtime vật lý · Hàng đợi: ${count} công việc.`;
}

async function handleChat(req, payload) {
  const decision = await decideWithChief({ message: payload.message, history: payload.history });
  if (decision.mode === 'reply' || decision.mode === 'clarify') {
    return { status: 200, body: { ok: true, mode: decision.mode, reply: decision.reply, modelUsed: decision.modelUsed, providerUsed: decision.providerUsed, usage: decision.usage } };
  }
  if (decision.mode === 'status') {
    const status = await legacyJson(req, { operation: 'status' });
    return { status: status.status, body: { ok: true, mode: 'status', reply: formatStatusReply(status.body), snapshot: status.body, modelUsed: decision.modelUsed, providerUsed: decision.providerUsed, usage: decision.usage } };
  }
  const credential = writeCredential(req);
  const result = await createCanonicalWorkOrder({ instruction: decision.instruction, priority: decision.priority, source: 'vercel-chief-single-door' }, credential.token);
  const stage = result.execution?.stage;
  const reply = result.deduplicated
    ? `${decision.reply}\n\nCông việc canonical #${result.issue.number} đã tồn tại; em không tạo bản trùng.`
    : stage === 'completed'
      ? `${decision.reply}\n\nCông việc #${result.issue.number} đã qua executor → evidence → reviewer → judge.`
      : stage === 'failed'
        ? `${decision.reply}\n\nCông việc #${result.issue.number} đã dừng fail-closed: ${result.execution?.blocker || 'gate failed'}.`
        : stage === 'physical-runtime-required'
          ? `${decision.reply}\n\nCông việc #${result.issue.number} cần runtime vật lý (${result.execution?.executionKind || 'device'}); TigerIQ đã chặn cloud executor trước khi gọi AI.`
          : `${decision.reply}\n\nĐã tạo công việc #${result.issue.number}; trạng thái ${stage || 'queued'}.`;
  return { status: result.deduplicated ? 200 : 201, body: { ...result, mode: 'work-order', reply, modelUsed: decision.modelUsed, providerUsed: decision.providerUsed, usage: decision.usage } };
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return legacyHandler(req, res);
    if (req.method !== 'POST') return legacyHandler(req, res);
    const raw = await rawBody(req);
    const payload = parsePayload(raw);
    const operation = String(payload.operation || 'status');

    if (operation === 'work-order') {
      const credential = writeCredential(req);
      const result = await createCanonicalWorkOrder({ ...payload, source: 'vercel-explicit-dispatch' }, credential.token);
      return json(res, result.deduplicated ? 200 : 201, result);
    }
    if (operation === 'chat') {
      const result = await handleChat(req, payload);
      return json(res, result.status, result.body);
    }
    if (operation === 'work-order-status') return json(res, 200, await workOrderStatus(payload, GITHUB_TOKEN));
    if (operation === 'work-board') return json(res, 200, await workBoard(GITHUB_TOKEN));
    return legacyHandler(clonedReq(req, raw), res);
  } catch (error) {
    const name = error instanceof Error ? error.message : String(error);
    let status = Number(error?.status) || 502;
    if (name === 'payload_too_large') status = 413;
    else if (name.startsWith('invalid_')) status = 400;
    else if (name === 'work_order_inflight') status = 409;
    else if (name === 'github_authorization_required' || name === 'github_401') status = 401;
    else if (name === 'github_403') status = 403;
    return json(res, status, { error: name, details: error?.details?.message || error?.details || undefined });
  }
}
