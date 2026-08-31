import { isOwnerAuthorized } from './owner-auth.mjs';

const REPO = process.env.TIGERIQ_REPO || 'newsdayads/tigeriq-ai-lab';
const GITHUB_TOKEN = String(process.env.TIGERIQ_GITHUB_TOKEN || '').trim();
const CANARY_ISSUE = Number(process.env.TIGERIQ_PC01_CANARY_ISSUE || '58');
const OWNER_AUTH_CONFIGURED = Boolean(
  String(process.env.TIGERIQ_OWNER_EMAIL || 'newsdayads@gmail.com').trim()
  && String(process.env.TIGERIQ_OWNER_GOOGLE_CLIENT_ID || '').trim()
  && String(process.env.TIGERIQ_OWNER_GOOGLE_CLIENT_SECRET || '').trim()
  && String(process.env.TIGERIQ_OWNER_OAUTH_REDIRECT_URI || '').trim()
  && String(process.env.TIGERIQ_OWNER_SESSION_SECRET || '').trim()
);

const LIFECYCLE = new Map([
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

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.end(JSON.stringify(body));
}

function repoParts() {
  const [owner, repo] = REPO.split('/');
  if (!owner || !repo) throw new Error('invalid_repo');
  return { owner, repo };
}

async function gh(path) {
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'tigeriq-web-control-status',
  };
  if (GITHUB_TOKEN) headers.authorization = `Bearer ${GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com${path}`, { headers, cache: 'no-store' });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const error = new Error(`github_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function lines(body) {
  return String(body || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function lifecycle(comments = []) {
  const events = [];
  for (const comment of Array.isArray(comments) ? comments : []) {
    const createdAt = comment?.created_at || null;
    for (const line of lines(comment?.body)) {
      const marker = line.split(/\s+/, 1)[0];
      const stage = LIFECYCLE.get(marker);
      if (stage) events.push({ marker, stage, createdAt });
    }
  }
  events.sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
  return events;
}

function evidence(comments = []) {
  const events = lifecycle(comments);
  const allLines = (Array.isArray(comments) ? comments : []).flatMap((comment) => lines(comment?.body));
  return {
    claimed: events.some((event) => event.stage === 'claimed'),
    result: events.some((event) => event.stage === 'completed'),
    failed: events.some((event) => event.stage === 'failed'),
    reviewPass: allLines.includes('REVIEW_PASS'),
    judgePass: allLines.includes('JUDGE_PASS'),
    latestStage: events.length ? events[events.length - 1].stage : null,
  };
}

function issueType(issue) {
  const body = String(issue?.body || '');
  if (body.includes('TIGERIQ_COMMAND_V1')) return 'command';
  if (body.includes('TIGERIQ_JOB_V1')) return 'work-order';
  return null;
}

function priority(issue) {
  const body = String(issue?.body || '');
  const field = body.match(/(?:^|\n)## Priority\s*\n\s*(P[012])\s*(?:\n|$)/i);
  if (field) return field[1].toUpperCase();
  const title = String(issue?.title || '');
  const match = title.match(/(?:^|[^A-Z0-9])(P[012])(?:[^A-Z0-9]|$)/i);
  return match ? match[1].toUpperCase() : null;
}

function pc01State(canary, canaryComments) {
  const proof = evidence(canaryComments);
  const stage = proof.latestStage;
  if (stage === 'completed') return { channel: 'verified', label: 'ĐÃ CÓ KẾT QUẢ', reason: `#${CANARY_ISSUE} có RESULT`, proof };
  if (stage === 'claimed') return { channel: 'working', label: 'ĐANG THỰC THI', reason: `#${CANARY_ISSUE} đã CLAIM`, proof };
  if (stage === 'failed') return { channel: 'degraded', label: 'LỖI THỰC THI', reason: `#${CANARY_ISSUE} có FAILED`, proof };
  return {
    channel: 'unverified',
    label: 'CHƯA XÁC NHẬN',
    reason: canary?.state === 'open' ? `#${CANARY_ISSUE} chưa có CLAIM/RESULT` : `#${CANARY_ISSUE} chưa có bằng chứng runtime`,
    proof,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  try {
    const { owner, repo } = repoParts();
    const [repoInfo, issues, comments, canary, canaryComments] = await Promise.all([
      gh(`/repos/${owner}/${repo}`),
      gh(`/repos/${owner}/${repo}/issues?state=all&per_page=50&sort=updated&direction=desc`),
      gh(`/repos/${owner}/${repo}/issues/comments?per_page=100&sort=updated&direction=desc`).catch(() => []),
      gh(`/repos/${owner}/${repo}/issues/${CANARY_ISSUE}`).catch(() => null),
      gh(`/repos/${owner}/${repo}/issues/${CANARY_ISSUE}/comments?per_page=100`).catch(() => []),
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

    const work = (Array.isArray(issues) ? issues : [])
      .filter((issue) => !issue.pull_request && issueType(issue))
      .slice(0, 20)
      .map((issue) => {
        const proof = evidence(commentsByIssue.get(issue.number) || []);
        let stage = proof.latestStage || (issue.state === 'closed' ? 'closed' : 'queued');
        if (issue.state === 'closed' && !proof.result && !proof.failed) stage = 'closed';
        return {
          number: issue.number,
          title: issue.title,
          type: issueType(issue),
          priority: priority(issue),
          state: issue.state,
          stage,
          updatedAt: issue.updated_at,
          url: issue.html_url,
          evidence: proof,
        };
      });

    const ownerAuthenticated = OWNER_AUTH_CONFIGURED && isOwnerAuthorized(req);
    const openWork = work.filter((item) => item.state === 'open');
    return json(res, 200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      repository: repoInfo.full_name,
      owner: {
        configured: OWNER_AUTH_CONFIGURED,
        authenticated: ownerAuthenticated,
        serverWriteConfigured: Boolean(GITHUB_TOKEN),
        writeReady: Boolean(ownerAuthenticated && GITHUB_TOKEN),
      },
      deployment: {
        environment: process.env.VERCEL_ENV || 'unknown',
        gitRef: process.env.VERCEL_GIT_COMMIT_REF || null,
        gitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      },
      pc01: {
        ...pc01State(canary, canaryComments),
        physicalState: 'unknown',
        canaryIssue: CANARY_ISSUE,
      },
      queue: {
        count: openWork.length,
        items: openWork.slice(0, 12),
      },
      work,
    });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 96);
    return json(res, Number(error?.status) || 502, { error: message });
  }
}
