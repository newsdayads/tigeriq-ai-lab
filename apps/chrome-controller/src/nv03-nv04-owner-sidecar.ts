import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  buildNv03ReviewPrompt,
  buildNv04Request,
  eligibleNv03ReviewIssue,
  eligibleNv04Issue,
  renderNv04GithubComment,
  renderNv04Request,
  inputRevision,
  resourceScope,
  type GithubIssueLike,
} from './nv03-nv04-coordination.js';
import { Nv04DriveTransport } from './nv04-drive-transport.js';
import {
  activeAppChromeClaims,
  claimGithubIssue,
  releaseGithubClaim,
  closeGithubIssueCompleted,
  workerEligibleForIssue,
  type GithubComment as CanonicalGithubComment,
  type GithubIssue as CanonicalGithubIssue,
} from './github-self-run.js';

type GithubComment = CanonicalGithubComment;
type GithubIssueApi = CanonicalGithubIssue;

const OWNER_SCOPE = 'APP_CHROME_NV03_NV04_COORDINATION_V1';
const controllerBase = String(process.env.TIGERIQ_CONTROLLER_URL || 'http://127.0.0.1:8798').replace(/\/$/, '');
const nv03SidecarBase = String(process.env.TIGERIQ_NV03_SIDECAR_URL || 'http://127.0.0.1:8823').replace(/\/$/, '');
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

function targetCompatible(issue: GithubIssueApi, worker: 'NV03' | 'NV04') {
  const body = String(issue.body || '');
  const values = [...body.matchAll(/^(?:TARGET_EMPLOYEE|ASSIGNED_EXECUTOR|EXECUTOR|PRIMARY_EMPLOYEE)\s*=\s*([^\n\r]+)/gmi)]
    .map((match) => String(match[1] || '').trim().toUpperCase())
    .filter(Boolean);
  return values.length === 0 || values.every((value) => value === worker);
}

async function nv03SidecarAssign(issue: GithubIssueApi, jobId: string, claimId: string) {
  const response = await fetch(`${nv03SidecarBase}/assign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      jobId,
      claimId,
      workOrder: `#${issue.number} - ${issue.title}`,
      issueUrl: issue.html_url,
      resourceScope: resourceScope(issue),
      inputRevision: inputRevision(issue),
      prompt: buildNv03ReviewPrompt(issue),
    }),
  });
  if (!response.ok) throw new Error(`NV03_SIDECAR_HTTP_${response.status}:${await response.text()}`);
}

async function nv03SidecarRelease(jobId: string) {
  const response = await fetch(`${nv03SidecarBase}/release`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ jobId }),
  });
  if (!response.ok) throw new Error(`NV03_SIDECAR_RELEASE_HTTP_${response.status}:${await response.text()}`);
}

async function controllerDispatchNv04(text: string, job: Record<string, string>) {
  const response = await fetch(`${controllerBase}/api/workers/NV04/dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ text, navigate: true, job }),
  });
  if (!response.ok) throw new Error(`CONTROLLER_NV04_HTTP_${response.status}:${await response.text()}`);
}

async function reconcileNv04Results(issues: GithubIssueApi[], transport: Nv04DriveTransport) {
  const { owner, repo } = repoParts();
  for (const issue of issues) {
    if (!eligibleNv04Issue(issue)) continue;
    const comments = await issueComments(issue.number);
    const claim = activeAppChromeClaims(comments).find((item) => item.workerId === 'NV04');
    if (!claim) continue;
    const request = buildNv04Request(issue);
    const found = transport.readValidatedResult(request);
    if (!found) continue;
    const comment = renderNv04GithubComment(request, found.result);
    await addIssueComment(issue.number, comment);
    transport.archiveCompleted(request, found.path);
    await releaseGithubClaim({ claimId: claim.claimId, workerId: 'NV04', issueNumber: issue.number, state: found.result.terminal, owner, repo, token: githubToken });
  }
}

async function reconcileNv03Results(issues: GithubIssueApi[]) {
  const { owner, repo } = repoParts();
  for (const issue of issues) {
    const comments = await issueComments(issue.number);
    const claim = activeAppChromeClaims(comments).find((item) => item.workerId === 'NV03');
    if (!claim) continue;
    const claimIndex = comments.findIndex((comment) => String(comment.body || '').includes('claim_id=' + claim.claimId));
    const later = claimIndex >= 0 ? comments.slice(claimIndex + 1) : comments;
    const resultComment = [...later].reverse().find((comment) => {
      const body = String(comment.body || '');
      if (!new RegExp('^CLAIM_ID\\s*=\\s*' + claim.claimId.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, '\\$&') + '$', 'mi').test(body)) return false;
      return /^(?:REVIEW\s*=\s*(?:PASS|CHANGES_REQUIRED)|STATE\s*=\s*(?:BLOCKED|EXTERNAL_WAIT))$/mi.test(body);
    });
    if (!resultComment) continue;
    const body = String(resultComment.body || '');
    let state = 'DONE';
    if (/^STATE\s*=\s*BLOCKED$/mi.test(body)) state = 'BLOCKED';
    else if (/^STATE\s*=\s*EXTERNAL_WAIT$/mi.test(body)) state = 'EXTERNAL_WAIT';
    else if (/^REVIEW\s*=\s*CHANGES_REQUIRED$/mi.test(body)) state = 'CHANGES_REQUIRED';
    const jobId = `APP-GH-${issue.number}-NV03-${claim.claimId.slice(0, 8)}`;
    await nv03SidecarRelease(jobId);
    await releaseGithubClaim({ claimId: claim.claimId, workerId: 'NV03', issueNumber: issue.number, state, owner, repo, token: githubToken });
    if (state === 'DONE' || state === 'CHANGES_REQUIRED') {
      await closeGithubIssueCompleted({ issueNumber: issue.number, owner, repo, token: githubToken });
    }
  }
}

async function dispatchOneNv03(issues: GithubIssueApi[]) {
  const { owner, repo } = repoParts();
  const candidates = issues.filter((issue) => workerEligibleForIssue('NV03', issue) && targetCompatible(issue, 'NV03'));
  for (const issue of candidates) {
    const comments = await issueComments(issue.number);
    if (activeAppChromeClaims(comments).length || markerIndex(comments, 'NV03_RESULT_BEGIN') >= 0) continue;
    const claim = await claimGithubIssue({ workerId: 'NV03', issue, owner, repo, token: githubToken });
    if (!claim) continue;
    const jobId = `APP-GH-${issue.number}-NV03-${claim.claimId.slice(0, 8)}`;
    try {
      await nv03SidecarAssign(issue, jobId, claim.claimId);
    } catch (error) {
      await releaseGithubClaim({ claimId: claim.claimId, workerId: 'NV03', issueNumber: issue.number, state: 'DISPATCH_ERROR', owner, repo, token: githubToken });
      throw error;
    }
    return issue.number;
  }
  return 0;
}

async function dispatchOneNv04(issues: GithubIssueApi[], transport: Nv04DriveTransport) {
  const { owner, repo } = repoParts();
  for (const issue of issues) {
    if (!eligibleNv04Issue(issue) || !targetCompatible(issue, 'NV04')) continue;
    const comments = await issueComments(issue.number);
    if (activeAppChromeClaims(comments).length || markerIndex(comments, 'NV04_RESULT_BEGIN') >= 0) continue;
    const claim = await claimGithubIssue({ workerId: 'NV04', issue, owner, repo, token: githubToken });
    if (!claim) continue;
    const request = buildNv04Request(issue);
    transport.writeNewRequest(request);
    transport.claimRequest(request);
    try {
      await controllerDispatchNv04(renderNv04Request(request), {
        jobId: request.jobId,
        issueRef: issue.html_url,
        title: `#${issue.number} - ${issue.title}`,
        source: 'NV04_DRIVE_BRIDGE',
      });
    } catch (error) {
      await releaseGithubClaim({ claimId: claim.claimId, workerId: 'NV04', issueNumber: issue.number, state: 'DISPATCH_ERROR', owner, repo, token: githubToken });
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

  if (selected.has('NV03')) {
    await reconcileNv03Results(issues);
    nv03Issue = await dispatchOneNv03(issues);
  }
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
