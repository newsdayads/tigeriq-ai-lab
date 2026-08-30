import { timingSafeEqual, randomUUID } from 'node:crypto';

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

function authorized(req) {
  if (!COMMAND_SECRET) return false;
  return safeEqual(req.headers['x-tigeriq-secret'], COMMAND_SECRET);
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += part.length;
    if (total > 32_768) throw new Error('payload_too_large');
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

async function gh(path, init = {}) {
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'tigeriq-command-center-vercel',
    ...(init.headers || {}),
  };
  if (GITHUB_TOKEN) headers.authorization = `Bearer ${GITHUB_TOKEN}`;
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

async function statusSnapshot() {
  const { owner, repo } = repoParts();
  const [repoInfo, openIssues, canary, comments] = await Promise.all([
    gh(`/repos/${owner}/${repo}`),
    gh(`/repos/${owner}/${repo}/issues?state=open&per_page=50&sort=updated&direction=desc`),
    gh(`/repos/${owner}/${repo}/issues/${CANARY_ISSUE}`).catch(() => null),
    gh(`/repos/${owner}/${repo}/issues/${CANARY_ISSUE}/comments?per_page=100`).catch(() => []),
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
    controlPlane: { vercel: 'online', github: 'online', repository: repoInfo.full_name },
    execution: { pc01, openclaw: 'unknown', ollama: 'unknown', canaryIssue: CANARY_ISSUE, canaryState: canary?.state || 'unknown' },
    queue: { count: jobs.length, jobs },
  };
}

async function createWorkOrder(payload) {
  if (!GITHUB_TOKEN) throw new Error('github_write_not_configured');
  const instruction = String(payload.instruction || '').trim();
  const priority = String(payload.priority || 'P1').toUpperCase();
  if (instruction.length < 3 || instruction.length > 4000) throw new Error('invalid_instruction');
  if (!ALLOWED_PRIORITIES.has(priority)) throw new Error('invalid_priority');

  const id = randomUUID();
  const titleText = instruction.replace(/\s+/g, ' ').slice(0, 72);
  const body = [
    'TIGERIQ_JOB_V1',
    '',
    `## Instruction`,
    instruction,
    '',
    '## Priority',
    priority,
    '',
    '## Source',
    'vercel-online',
    '',
    '## Request ID',
    id,
  ].join('\n');

  const { owner, repo } = repoParts();
  const issue = await gh(`/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: `[${priority}] [Command Center] ${titleText}`, body }),
  });
  return { ok: true, requestId: id, issue: { number: issue.number, url: issue.html_url, title: issue.title } };
}

async function createCanary() {
  if (!GITHUB_TOKEN) throw new Error('github_write_not_configured');
  const id = `vercel-canary-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const body = `TIGERIQ_COMMAND_V1\n\`\`\`json\n${JSON.stringify({ idempotency_key: id, action: 'system.status', args: {} }, null, 2)}\n\`\`\``;
  const { owner, repo } = repoParts();
  const issue = await gh(`/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: `[P0] PC01 Vercel canary ${new Date().toISOString()}`, body }),
  });
  return { ok: true, idempotencyKey: id, issue: { number: issue.number, url: issue.html_url } };
}

export default async function handler(req, res) {
  if (req.method === 'GET') return json(res, 200, { ok: true, service: 'tigeriq-command-center', authRequired: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  if (!authorized(req)) return json(res, 401, { error: 'unauthorized' });

  try {
    const payload = await readBody(req);
    const operation = String(payload.operation || 'status');
    if (operation === 'status') return json(res, 200, await statusSnapshot());
    if (operation === 'work-order') return json(res, 201, await createWorkOrder(payload));
    if (operation === 'canary') return json(res, 201, await createCanary());
    return json(res, 400, { error: 'unsupported_operation' });
  } catch (error) {
    const name = error instanceof Error ? error.message : String(error);
    const status = name === 'payload_too_large' ? 413 : name.startsWith('invalid_') ? 400 : name === 'github_write_not_configured' ? 503 : 502;
    return json(res, status, { error: name, details: error?.details?.message || undefined });
  }
}
