import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  buildNv03ReviewPrompt,
  buildNv04Request,
  eligibleNv03ReviewIssue,
  eligibleNv04Issue,
  renderNv04GithubComment,
  renderNv04Request,
  type GithubIssueLike,
} from './nv03-nv04-coordination.js';
import { Nv04DriveTransport } from './nv04-drive-transport.js';

type GithubComment = { body?: string | null };
type GithubIssueApi = GithubIssueLike & { pull_request?: unknown };

const OWNER_SCOPE = 'APP_CHROME_NV03_NV04_COORDINATION_V1';
const controllerBase = String(process.env.TIGERIQ_CONTROLLER_URL || 'http://127.0.0.1:8798').replace(/\/$/, '');
const driveRoot = String(process.env.TIGERIQ_NV04_DRIVE_ROOT || 'G:\\Drive của tôi\\TigerIQ AI Lab\\03_GEMINI_REVIEW');
const repoFullName = String(process.env.TIGERIQ_REPO || 'newsdayads/tigeriq-ai-lab');
const githubToken = String(process.env.TIGERIQ_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '');

function selectedWorkers() {
  const raw = String(process.env.TIGERIQ_NV0304_WORKERS || '').toUpperCase().split(',').map((x) => x.trim()).filter(Boolean);
  const selected = new Set(raw);
  if (!selected.size) throw new Error('OWNER_WORKER_SELECTION_REQUIRED');
  for (const id of selected) if (!['NV03','NV04'].includes(id)) throw new Error(`OWNER_WORKER_SELECTION_INVALID:${id}`);
  return selected;
}

function requireOwnerDirectArm() {
  if (process.env.TIGERIQ_NV0304_OWNER_DIRECT !== '1') throw new Error('OWNER_DIRECT_ARM_REQUIRED');
  if (process.env.TIGERIQ_NV0304_SCOPE !== OWNER_SCOPE) throw new Error('OWNER_SCOPE_MISMATCH');
  return selectedWorkers();
}

function githubHeaders() {
  if (!githubToken) throw new Error('GITHUB_TOKEN_REQUIRED');
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${githubToken}`,
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
  };
}

async function github<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.github.com${path}`, { ...init, headers: { ...githubHeaders(), ...(init.headers || {}) } });
  if (!response.ok) throw new Error(`GITHUB_HTTP_${response.status}:${await response.text()}`);
  return response.status === 204 ? undefined as T : await response.json() as T;
}

function repoParts() {
  const [owner, repo] = repoFullName.split('/');
  if (!owner || !repo) throw new Error('TIGERIQ_REPO_INVALID');
  return { owner, repo };
}

async function listOpenIssues() {
  const { owner, repo } = repoParts();
  const rows = await github<GithubIssueApi[]>(`/repos/${owner}/${repo}/issues?state=open&per_page=100&sort=created&direction=asc`);
  return rows.filter((row) => !row.pull_request);
}

async function issueComments(issueNumber: number) {
  const { owner, repo } = repoParts();
  return github<GithubComment[]>(`/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`);
}

async function addIssueComment(issueNumber: number, body: string) {
  const { owner, repo } = repoParts();
  await github(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

function markerIndex(comments: GithubComment[], marker: string) {
  for (let i = comments.length - 1; i >= 0; i -= 1) {
    if (String(comments[i]?.body || '').includes(marker)) return i;
  }
  return -1;
}

function hasActiveClaim(comments: GithubComment[], worker: 'NV03' | 'NV04') {
  const claim = markerIndex(comments, `[${worker}_CLAIM]`);
  if (claim < 0) return false;
  const release = markerIndex(comments, `[${worker}_RELEASE]`);
  const result = markerIndex(comments, `${worker}_RESULT_BEGIN`);
  return claim > Math.max(release, result);
}

function claimBody(worker: 'NV03' | 'NV04', issue: GithubIssueLike, jobId: string, revision: string) {
  return [
    `[${worker}_CLAIM]`,
    `worker=${worker}`,
    `job_id=${jobId}`,
    `input_revision=${revision}`,
    `resource_scope=${String((issue.body || '').match(/(?:^|\\n)RESOURCE_SCOPE=([^\\n\\r]+)/i)?.[1] || `ISSUE_${issue.number}`).trim()}`,
    `owner_scope=${OWNER_SCOPE}`,
  ].join('\n');
}

function releaseBody(worker: 'NV03' | 'NV04', jobId: string, state: string) {
  return [`[${worker}_RELEASE]`, `worker=${worker}`, `job_id=${jobId}`, `state=${state}`].join('\n');
}

async function controllerDispatch(worker: 'NV03' | 'NV04', text: string, job: Record<string, string>) {
  const response = await fetch(`${controllerBase}/api/workers/${worker}/dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ text, navigate: true, job }),
  });
  if (!response.ok) throw new Error(`CONTROLLER_${worker}_HTTP_${response.status}:${await response.text()}`);
}

async function reconcileNv04Results(issues: GithubIssueApi[], transport: Nv04DriveTransport) {
  for (const issue of issues) {
    if (!eligibleNv04Issue(issue)) continue;
    const comments = await issueComments(issue.number);
    if (!hasActiveClaim(comments, 'NV04')) continue;
    const request = buildNv04Request(issue);
    const found = transport.readValidatedResult(request);
    if (!found) continue;
    const comment = renderNv04GithubComment(request, found.result);
    await addIssueComment(issue.number, comment);
    transport.archiveCompleted(request, found.path);
    await addIssueComment(issue.number, releaseBody('NV04', request.jobId, found.result.terminal));
  }
}

async function dispatchOneNv03(issues: GithubIssueApi[]) {
  for (const issue of issues) {
    if (!eligibleNv03ReviewIssue(issue)) continue;
    const comments = await issueComments(issue.number);
    if (hasActiveClaim(comments, 'NV03') || markerIndex(comments, 'NV03_RESULT_BEGIN') >= 0) continue;
    const revision = String((issue.body || '').match(/(?:^|\n)(?:EXACT_HEAD|EXACT_INPUT)=([^\n\r]+)/i)?.[1] || `ISSUE-${issue.number}`).trim();
    const jobId = `NV03-${issue.number}-${revision.slice(0, 12).replace(/[^A-Za-z0-9_-]/g, '_')}`;
    await addIssueComment(issue.number, claimBody('NV03', issue, jobId, revision));
    try {
      await controllerDispatch('NV03', buildNv03ReviewPrompt(issue), {
        jobId,
        issueRef: issue.html_url,
        title: `#${issue.number} - ${issue.title}`,
        source: 'NV03_GITHUB_REVIEW',
      });
    } catch (error) {
      await addIssueComment(issue.number, releaseBody('NV03', jobId, 'DISPATCH_ERROR'));
      throw error;
    }
    return issue.number;
  }
  return 0;
}

async function dispatchOneNv04(issues: GithubIssueApi[], transport: Nv04DriveTransport) {
  for (const issue of issues) {
    if (!eligibleNv04Issue(issue)) continue;
    const comments = await issueComments(issue.number);
    if (hasActiveClaim(comments, 'NV04') || markerIndex(comments, 'NV04_RESULT_BEGIN') >= 0) continue;
    const request = buildNv04Request(issue);
    transport.writeNewRequest(request);
    await addIssueComment(issue.number, claimBody('NV04', issue, request.jobId, request.inputRevision));
    transport.claimRequest(request);
    try {
      await controllerDispatch('NV04', renderNv04Request(request), {
        jobId: request.jobId,
        issueRef: issue.html_url,
        title: `#${issue.number} - ${issue.title}`,
        source: 'NV04_DRIVE_BRIDGE',
      });
    } catch (error) {
      await addIssueComment(issue.number, releaseBody('NV04', request.jobId, 'DISPATCH_ERROR'));
      throw error;
    }
    return issue.number;
  }
  return 0;
}

export async function runOwnerDirectedCycle() {
  const selected = requireOwnerDirectArm();
  const issues = await listOpenIssues();
  let nv03Issue = 0;
  let nv04Issue = 0;

  if (selected.has('NV03')) nv03Issue = await dispatchOneNv03(issues);
  if (selected.has('NV04')) {
    const transport = new Nv04DriveTransport(driveRoot);
    transport.ensureLayout();
    await reconcileNv04Results(issues, transport);
    nv04Issue = await dispatchOneNv04(issues, transport);
  }

  return { ownerScope: OWNER_SCOPE, selectedWorkers: [...selected], nv03Issue, nv04Issue, driveRoot: selected.has('NV04') ? driveRoot : null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOwnerDirectedCycle()
    .then((result) => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch((error) => {
      process.stderr.write(String(error instanceof Error ? error.message : error) + '\n');
      process.exitCode = 1;
    });
}
