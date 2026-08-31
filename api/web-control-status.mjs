import { isOwnerAuthorized } from './owner-auth.mjs';
import { issueEvidenceSummary, issueStage, issueType, issuePriority } from './control.mjs';

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

function pc01State(canary, canaryComments) {
  const proof = issueEvidenceSummary(canaryComments);
  const stage = issueStage(canary, canaryComments);
  if (stage === 'completed') return { channel: 'verified', label: 'ĐÃ QUA BẰNG CHỨNG + REVIEW/GATE', reason: `#${CANARY_ISSUE} đủ RESULT + evidence + REVIEW_PASS + JUDGE_PASS`, proof };
  if (stage === 'claimed') return { channel: 'working', label: 'ĐANG THỰC THI', reason: `#${CANARY_ISSUE} đã CLAIM`, proof };
  if (stage === 'failed') return { channel: 'degraded', label: 'LỖI THỰC THI', reason: `#${CANARY_ISSUE} có FAILED mới nhất`, proof };
  return {
    channel: 'unverified',
    label: 'CHƯA ĐỦ BẰNG CHỨNG',
    reason: `#${CANARY_ISSUE} stage=${stage}; không coi Issue đóng/RESULT đơn lẻ là hoàn tất`,
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
      .filter((issue) => !issue.pull_request && issueType(issue) !== 'unknown')
      .slice(0, 20)
      .map((issue) => {
        const issueComments = commentsByIssue.get(issue.number) || [];
        return {
          number: issue.number,
          title: issue.title,
          type: issueType(issue),
          priority: issuePriority(issue),
          state: issue.state,
          stage: issueStage(issue, issueComments),
          updatedAt: issue.updated_at,
          url: issue.html_url,
          evidence: issueEvidenceSummary(issueComments),
        };
      });

    const ownerAuthenticated = OWNER_AUTH_CONFIGURED && isOwnerAuthorized(req);
    const activeWork = work.filter((item) => !['completed', 'failed', 'cancelled'].includes(item.stage));
    return json(res, 200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      repository: repoInfo.full_name,
      owner: {
        configured: OWNER_AUTH_CONFIGURED,
        authenticated: ownerAuthenticated,
        serverWriteConfigured: Boolean(GITHUB_TOKEN),
        writeReady: Boolean(ownerAuthenticated && GITHUB_TOKEN),
        browserWriteRequiresOwner: true,
        clientGithubTokenAcceptedForWrite: false,
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
        canaryCreationPolicy: 'canonical-existing-issue-only',
      },
      queue: { count: activeWork.length, items: activeWork.slice(0, 12) },
      work,
    });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 96);
    return json(res, Number(error?.status) || 502, { error: message });
  }
}
