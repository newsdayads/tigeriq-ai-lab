import { timingSafeEqual, randomUUID, createHash } from 'node:crypto';
import { decideWithChief } from './chief.mjs';

const REPO = process.env.TIGERIQ_REPO || 'newsdayads/tigeriq-ai-lab';
const COMMAND_SECRET = process.env.TIGERIQ_COMMAND_SECRET || '';
const GITHUB_TOKEN = process.env.TIGERIQ_GITHUB_TOKEN || '';
const CANARY_ISSUE = Number(process.env.TIGERIQ_PC01_CANARY_ISSUE || '58');
const ALLOWED_PRIORITIES = new Set(['P0', 'P1', 'P2']);

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
  return safeEqual(req.headers['x-tigeriq-secret'], COMMAND_SECRET);
}

function clientGithubToken(req) {
  const value = req.headers['x-tigeriq-github-token'];
  return typeof value === 'string' ? value.trim() : '';
}

function writeCredential(req) {
  const clientToken = clientGithubToken(req);
  if (clientToken) return { token: clientToken, mode: 'client-token' };
  if (GITHUB_TOKEN && authorizedByServerSecret(req)) return { token: GITHUB_TOKEN, mode: 'server-token' };
  const error = new Error('github_authorization_required');
  error.status = 401;
  throw error;
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

export function issueEvidenceSummary(comments = []) {
  const bodies = Array.isArray(comments) ? comments.map((x) => String(x?.body || x || '')) : [];
  return {
    claimed: bodies.some((x) => x.includes('TIGERIQ_PC01_CLAIMED') || x.includes('TIGERIQ_JOB_CLAIMED') || x.includes('TIGERIQ_COMMAND_CLAIMED')),
    result: bodies.some((x) => x.includes('TIGERIQ_PC01_DONE') || x.includes('TIGERIQ_PC01_RESULT') || x.includes('TIGERIQ_JOB_DONE') || x.includes('TIGERIQ_JOB_RESULT') || x.includes('TIGERIQ_COMMAND_RESULT')),
    failed: bodies.some((x) => x.includes('TIGERIQ_PC01_FAILED') || x.includes('TIGERIQ_JOB_FAILED') || x.includes('TIGERIQ_COMMAND_FAILED')),
    reviewPass: bodies.some((x) => x.includes('REVIEW_PASS')),
    judgePass: bodies.some((x) => x.includes('JUDGE_PASS')),
  };
}

export function issueStage(issue, comments = []) {
  const evidence = issueEvidenceSummary(comments);
  if (evidence.failed) return 'failed';
  if (issue?.state === 'closed' && ['not_planned', 'duplicate'].includes(String(issue?.state_reason || ''))) return 'cancelled';
  if (evidence.result || issue?.state === 'closed') return 'completed';
  if (evidence.claimed) return 'claimed';
  return 'queued';
}

async function findDuplicateOpenWorkOrder(fingerprint, token) {
  const { owner, repo } = repoParts();
  const issues = await gh(`/repos/${owner}/${repo}/issues?state=open&per_page=100&sort=updated&direction=desc`, {}, token);
  return issues.find((item) => !item.pull_request && typeof item.body === 'string' && item.body.includes('TIGERIQ_JOB_V1') && item.body.includes(`## Fingerprint\n${fingerprint}`)) || null;
}

async function statusSnapshot(token = '') {
  const { owner, repo } = repoParts();
  const [repoInfo, openIssues, canary, comments] = await Promise.all([
    gh(`/repos/${owner}/${repo}`, {}, token),
    gh(`/repos/${owner}/${repo}/issues?state=open&per_page=50&sort=updated&direction=desc`, {}, token),
    gh(`/repos/${owner}/${repo}/issues/${CANARY_ISSUE}`, {}, token).catch(() => null),
    gh(`/repos/${owner}/${repo}/issues/${CANARY_ISSUE}/comments?per_page=100`, {}, token).catch(() => []),
  ]);

  const jobs = openIssues
    .filter((item) => !item.pull_request && typeof item.body === 'string' && (item.body.includes('TIGERIQ_JOB_V1') || item.body.includes('TIGERIQ_COMMAND_V1')))
    .slice(0, 20)
    .map((item) => ({
      number: item.number,
      title: item.title,
      state: item.state,
      updatedAt: item.updated_at,
      url: item.html_url,
      type: item.body.includes('TIGERIQ_COMMAND_V1') ? 'command' : 'work-order',
    }));

  const bodies = Array.isArray(comments) ? comments.map((x) => String(x.body || '')) : [];
  const claimed = bodies.some((x) => x.includes('TIGERIQ_PC01_CLAIMED'));
  const terminal = bodies.some((x) => x.includes('TIGERIQ_PC01_DONE') || x.includes('TIGERIQ_PC01_RESULT'));
  const failed = bodies.some((x) => x.includes('TIGERIQ_PC01_FAILED'));
  const pc01 = terminal ? 'online' : claimed ? 'working' : failed ? 'degraded' : 'offline';

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    controlPlane: {
      vercel: 'online',
      github: 'online',
      repository: repoInfo.full_name,
      serverWriteConfigured: Boolean(GITHUB_TOKEN && COMMAND_SECRET),
      clientTokenSupported: true,
      chiefOfStaff: 'gpt',
      workOrderDedupe: true,
      workOrderStatusTracking: true,
      workOrderLifecycleEvidence: true,
    },
    execution: {
      pc01,
      openclaw: 'unknown',
      ollama: 'unknown',
      canaryIssue: CANARY_ISSUE,
      canaryState: canary?.state || 'unknown',
    },
    queue: { count: jobs.length, jobs },
  };
}

async function githubIdentity(token) {
  if (!token) {
    const error = new Error('github_authorization_required');
    error.status = 401;
    throw error;
  }
  const { owner, repo } = repoParts();
  const [user, repoInfo] = await Promise.all([
    gh('/user', {}, token),
    gh(`/repos/${owner}/${repo}`, {}, token),
  ]);
  return {
    ok: true,
    login: user.login,
    repository: repoInfo.full_name,
    repositoryAccess: true,
  };
}

async function createWorkOrder(payload, token) {
  const instruction = String(payload.instruction || payload.message || '').trim();
  const priority = String(payload.priority || 'P1').toUpperCase();
  if (instruction.length < 3 || instruction.length > 4000) throw new Error('invalid_instruction');
  if (!ALLOWED_PRIORITIES.has(priority)) throw new Error('invalid_priority');

  const fingerprint = workFingerprint(instruction);
  const duplicate = await findDuplicateOpenWorkOrder(fingerprint, token);
  if (duplicate) {
    return {
      ok: true,
      deduplicated: true,
      fingerprint,
      requestId: null,
      issue: { number: duplicate.number, url: duplicate.html_url, title: duplicate.title },
    };
  }

  const id = randomUUID();
  const titleText = instruction.replace(/\s+/g, ' ').slice(0, 72);
  const body = [
    'TIGERIQ_JOB_V1',
    '',
    '## Instruction',
    instruction,
    '',
    '## Priority',
    priority,
    '',
    '## Source',
    'vercel-chat-chief-of-staff',
    '',
    '## Request ID',
    id,
    '',
    '## Fingerprint',
    fingerprint,
    '',
    '## Governance',
    'Chief of Staff classified this as an explicit execution request. Execution still requires normal TigerIQ evidence/review/gate.',
  ].join('\n');

  const { owner, repo } = repoParts();
  const issue = await gh(`/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: `[${priority}] [TigerIQ AI] ${titleText}`, body }),
  }, token);
  return {
    ok: true,
    deduplicated: false,
    fingerprint,
    requestId: id,
    issue: { number: issue.number, url: issue.html_url, title: issue.title },
  };
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
  const stage = issueStage(issue, comments);
  const evidence = issueEvidenceSummary(comments);
  return {
    ok: true,
    issue: {
      number: issue.number,
      title: issue.title,
      state: issue.state,
      stateReason: issue.state_reason || null,
      stage,
      url: issue.html_url,
      updatedAt: issue.updated_at,
      comments: Array.isArray(comments) ? comments.length : 0,
      evidence,
    },
  };
}

async function createCanary(token) {
  const id = `vercel-canary-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const body = `TIGERIQ_COMMAND_V1\n\`\`\`json\n${JSON.stringify({ idempotency_key: id, action: 'system.status', args: {} }, null, 2)}\n\`\`\``;
  const { owner, repo } = repoParts();
  const issue = await gh(`/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: `[P0] PC01 Web Control canary ${new Date().toISOString()}`, body }),
  }, token);
  return { ok: true, idempotencyKey: id, issue: { number: issue.number, url: issue.html_url } };
}

function formatStatusReply(snapshot) {
  const pc = snapshot.execution.pc01 === 'online'
    ? 'trực tuyến'
    : snapshot.execution.pc01 === 'working'
      ? 'đang làm việc'
      : snapshot.execution.pc01 === 'degraded'
        ? 'có lỗi'
        : 'ngắt kết nối';
  return `Vercel: trực tuyến · GitHub: trực tuyến · PC01: ${pc} · OpenClaw: chưa xác định · Ollama: chưa xác định · Hàng đợi: ${snapshot.queue.count} công việc.`;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const snapshot = await statusSnapshot(clientGithubToken(req));
      return json(res, 200, snapshot);
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

    const payload = await readBody(req);
    const operation = String(payload.operation || 'status');
    const optionalToken = clientGithubToken(req);

    if (operation === 'status') return json(res, 200, await statusSnapshot(optionalToken));
    if (operation === 'whoami') return json(res, 200, await githubIdentity(writeCredential(req).token));
    if (operation === 'work-order-status') return json(res, 200, await workOrderStatus(payload, optionalToken));

    if (operation === 'chat') {
      const decision = await decideWithChief({ message: payload.message, history: payload.history });

      if (decision.mode === 'status') {
        const snapshot = await statusSnapshot(optionalToken);
        return json(res, 200, {
          ok: true,
          mode: 'status',
          reply: formatStatusReply(snapshot),
          snapshot,
          modelUsed: decision.modelUsed,
          providerUsed: decision.providerUsed,
          usage: decision.usage,
        });
      }

      if (decision.mode === 'reply' || decision.mode === 'clarify') {
        return json(res, 200, {
          ok: true,
          mode: decision.mode,
          reply: decision.reply,
          modelUsed: decision.modelUsed,
          providerUsed: decision.providerUsed,
          usage: decision.usage,
        });
      }

      const credential = writeCredential(req);
      const result = await createWorkOrder({
        instruction: decision.instruction,
        priority: decision.priority,
      }, credential.token);
      const workReply = result.deduplicated
        ? `${decision.reply}\n\nCông việc này đang được theo dõi ở #${result.issue.number}; em không tạo bản trùng.`
        : `${decision.reply}\n\nĐã tạo công việc #${result.issue.number}. Em sẽ theo dõi execution → review → gate → evidence.`;
      return json(res, result.deduplicated ? 200 : 201, {
        ...result,
        mode: 'work-order',
        reply: workReply,
        modelUsed: decision.modelUsed,
        providerUsed: decision.providerUsed,
        usage: decision.usage,
      });
    }

    if (operation === 'work-order') {
      const result = await createWorkOrder(payload, writeCredential(req).token);
      return json(res, result.deduplicated ? 200 : 201, result);
    }
    if (operation === 'canary') return json(res, 201, await createCanary(writeCredential(req).token));
    return json(res, 400, { error: 'unsupported_operation' });
  } catch (error) {
    const name = error instanceof Error ? error.message : String(error);
    let status = Number(error?.status) || 502;
    if (name === 'payload_too_large') status = 413;
    else if (name.startsWith('invalid_')) status = 400;
    else if (name === 'github_authorization_required') status = 401;
    else if (name === 'github_401') status = 401;
    else if (name === 'github_403') status = 403;
    return json(res, status, { error: name, details: error?.details?.message || error?.details || undefined });
  }
}
