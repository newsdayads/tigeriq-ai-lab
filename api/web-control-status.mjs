import { getOwnerSession, ownerAuthConfigured, ownerGoogleClientId } from './owner-auth.mjs';
import { issueEvidenceSummary, issueStage, issueType, issuePriority } from './control.mjs';
import { cloudWorkforceDescriptor } from './cloud-workforce.mjs';

const REPO = process.env.TIGERIQ_REPO || 'newsdayads/tigeriq-ai-lab';
const GITHUB_TOKEN = String(process.env.TIGERIQ_GITHUB_TOKEN || '').trim();
const CANARY_ISSUE = Number(process.env.TIGERIQ_PC01_CANARY_ISSUE || '58');
const COMMENT_FALLBACK_LIMIT = 6;
// UI-facing title is Vietnamese; RBAC remains Owner internally.

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

function cleanPresentation(value, max = 700) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function section(body, heading) {
  const text = String(body || '').replace(/\r/g, '');
  const marker = `## ${heading}`;
  const start = text.indexOf(marker);
  if (start < 0) return '';
  const contentStart = start + marker.length;
  const rest = text.slice(contentStart).replace(/^\s*\n/, '');
  const nextHeading = rest.search(/\n##\s+/);
  return cleanPresentation(nextHeading >= 0 ? rest.slice(0, nextHeading) : rest);
}

export function workResultPresentation(comments = []) {
  const rows = Array.isArray(comments) ? comments : [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const body = String(rows[index]?.body || rows[index] || '');
    if (!/(?:^|\n)TIGERIQ_JOB_RESULT(?:\n|$)/.test(body)) continue;
    const evidenceRef = body.match(/(?:^|\n)EVIDENCE_REF\s+([^\s]+)(?:\n|$)/)?.[1] || '';
    const result = section(body, 'Result');
    const expectedEvidence = section(body, 'Expected Evidence');
    const evidenceSummary = section(body, 'Evidence Summary');
    return {
      result,
      expectedEvidence,
      evidenceSummary,
      evidenceRef: cleanPresentation(evidenceRef, 160),
      createdAt: rows[index]?.created_at || null,
    };
  }
  return null;
}

export function workDisplayTitle(title, presentation) {
  const base = cleanPresentation(title, 260);
  if (!presentation?.result) return base;
  return `${base} · KẾT QUẢ: ${cleanPresentation(presentation.result, 120)}`;
}

function summarizeIssue(issue, issueComments = []) {
  const resultPresentation = workResultPresentation(issueComments);
  return {
    number: issue.number,
    title: workDisplayTitle(issue.title, resultPresentation),
    sourceTitle: issue.title,
    type: issueType(issue),
    priority: issuePriority(issue),
    state: issue.state,
    stage: issueStage(issue, issueComments),
    updatedAt: issue.updated_at,
    url: issue.html_url,
    result: resultPresentation,
    evidence: issueEvidenceSummary(issueComments),
  };
}

export function needsIssueCommentFallback(item) {
  return ['closed_unverified', 'evidence_pending', 'review_pending', 'gate_pending'].includes(String(item?.stage || ''));
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

    const workIssues = (Array.isArray(issues) ? issues : [])
      .filter((issue) => !issue.pull_request && issueType(issue) !== 'unknown')
      .slice(0, 20);

    let work = workIssues.map((issue) => summarizeIssue(issue, commentsByIssue.get(issue.number) || []));

    const fallbackNumbers = work
      .filter(needsIssueCommentFallback)
      .slice(0, COMMENT_FALLBACK_LIMIT)
      .map((item) => item.number);

    if (fallbackNumbers.length) {
      const fullCommentRows = await Promise.all(fallbackNumbers.map(async (number) => {
        const rows = await gh(`/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`).catch(() => null);
        return [number, Array.isArray(rows) ? rows : null];
      }));
      const fullCommentsByIssue = new Map(fullCommentRows.filter(([, rows]) => rows));
      work = workIssues.map((issue) => summarizeIssue(
        issue,
        fullCommentsByIssue.get(issue.number) || commentsByIssue.get(issue.number) || [],
      ));
    }

    const configured = ownerAuthConfigured();
    const ownerIdentity = configured ? getOwnerSession(req) : null;
    const ownerAuthenticated = Boolean(ownerIdentity);
    const activeWork = work.filter((item) => !['completed', 'failed', 'cancelled'].includes(item.stage));
    return json(res, 200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      repository: repoInfo.full_name,
      owner: {
        configured,
        identityMode: 'google_id_token',
        clientSecretRequired: false,
        googleClientId: ownerGoogleClientId() || null,
        authenticated: ownerAuthenticated,
        identity: ownerIdentity,
        authorization: {
          authority: 'TigerIQ',
          role: ownerAuthenticated ? 'Chủ tịch' : null,
          rbacRole: ownerAuthenticated ? 'Owner' : null,
          title: ownerAuthenticated ? 'Chủ tịch · TigerIQ AI Lab' : null,
          implementedRoles: ['Owner'],
          requestedRoles: ['Owner', 'Admin', 'Nhân viên', 'Chỉ xem'],
          providerInterface: '06-work-management-rbac-required',
          googleControlsAuthorization: false,
        },
        serverWriteConfigured: Boolean(GITHUB_TOKEN),
        writeReady: Boolean(ownerAuthenticated && GITHUB_TOKEN),
        browserWriteRequiresOwner: true,
        clientGithubTokenAcceptedForWrite: false,
      },
      cloudWorkforce: cloudWorkforceDescriptor(),
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
