import { execFileSync } from 'node:child_process';
import {
  NV02_LOCAL_GITHUB_SELF_PULL,
  buildNv02LocalSelfPullPrompt,
  claimNv02WorkOrder,
  noEligibleNv02Work,
  selectNv02WorkOrder,
  releaseNv02WorkOrder,
  nv02PrioritySummary,
} from '../apps/tigeriq-core/nv02-local-self-pull.mjs';

const OWNER = 'newsdayads';
const REPO = 'tigeriq-ai-lab';
const CONTROLLER = process.env.TIGERIQ_CHROME_CONTROLLER_URL || 'http://127.0.0.1:8798';
const WORKER = 'NV02';
const POLL_MS = 15_000;
const TIMEOUT_MS = 30 * 60 * 1000;

function gh(args) {
  return JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
}
function issueComments(number) { return gh([`repos/${OWNER}/${REPO}/issues/${number}/comments?per_page=100`]); }
function postComment(number, body) {
  if (body === null) return issueComments(number);
  return gh([`repos/${OWNER}/${REPO}/issues/${number}/comments`, '-X', 'POST', '-f', `body=${body}`]);
}
function summaries() {
  return gh([`repos/${OWNER}/${REPO}/issues?state=open&per_page=100&sort=updated&direction=asc`, '--jq', '[.[] | select(.pull_request|not) | {number,title,html_url,state,updated_at}]']);
}
function details(summary) { return gh([`repos/${OWNER}/${REPO}/issues/${summary.number}`]); }
function dependencyMap(issue) {
  const body = String(issue.body || '');
  const raw = body.match(/^DEPENDS_ON\s*=\s*(.+)$/mi)?.[1] || '';
  const map = new Map();
  for (const ref of raw.split(/[,\s]+/).map((x) => x.replace(/^#/, '')).filter(Boolean)) {
    const dep = gh([`repos/${OWNER}/${REPO}/issues/${ref}`]);
    map.set(Number(ref), dep.state === 'closed' && dep.state_reason === 'completed');
  }
  return map;
}
async function controllerDispatch(issue, lease) {
  const response = await fetch(`${CONTROLLER}/api/workers/NV02/dispatch`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: buildNv02LocalSelfPullPrompt(issue, lease), navigate: false,
      job: { issueRef: issue.html_url, title: `#${issue.number} - ${issue.title}`, source: 'NV02_LOCAL_SELF_PULL' } }),
  });
  if (!response.ok) throw new Error(`NV02_DISPATCH_HTTP_${response.status}:${await response.text()}`);
  return response.json();
}
function terminal(issue, comments) {
  const text = comments.map((x) => String(x.body || '')).join('\n');
  if (issue.state === 'closed' && issue.state_reason === 'completed') return 'DONE';
  if (new RegExp(`CLAIM_ID=.*STATE=DONE`, 'i').test(text) || /STATE=DONE/i.test(text)) return 'DONE';
  if (/STATE=BLOCKED/i.test(text)) return 'BLOCKED';
  return null;
}
function hasTerminalEvidence(issue) {
  return terminal(issue, issueComments(issue.number)) !== null;
}

console.log(JSON.stringify({ event: 'NV02_COMMAND_02', mode: 'SELF_PULL', policy: NV02_LOCAL_GITHUB_SELF_PULL }));
const candidateIssues = summaries()
  .filter((summary) => nv02PrioritySummary(summary) !== 'P0')
  .map((summary) => details(summary))
  .filter((issue) => !hasTerminalEvidence(issue));
const selected = selectNv02WorkOrder(candidateIssues, { dependencies: new Map() });
if (!selected) { console.log(JSON.stringify({ event: 'NV02_READY_NO_ELIGIBLE_WORK', ...noEligibleNv02Work() })); process.exit(0); }
const issue = selected.issue;
const lease = await claimNv02WorkOrder({ issue, comments: issueComments(issue.number), postComment });
if (!lease) throw new Error(`NV02_LEASE_BUSY_OR_LOST:${issue.number}`);
console.log(JSON.stringify({ event: 'TIGERIQ_NV02_LEASE_ACQUIRED', issue: issue.number, resourceScope: lease.resourceScope, leaseId: lease.leaseId }));
let result = null;
try {
  await controllerDispatch(issue, lease);
  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    const fresh = details(issue);
    result = terminal(fresh, issueComments(issue.number));
    if (result) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  if (!result) result = 'BLOCKED';
} catch (error) {
  result = 'DISPATCH_BLOCKED';
  console.error(JSON.stringify({ event: 'NV02_DISPATCH_BLOCKED', issue: issue.number, error: String(error) }));
}
await releaseNv02WorkOrder({ issueNumber: issue.number, leaseId: lease.leaseId, state: result, postComment });
console.log(JSON.stringify({ event: 'TIGERIQ_NV02_LEASE_RELEASED', issue: issue.number, resourceScope: lease.resourceScope, leaseId: lease.leaseId, state: result }));
const nextIssues = summaries()
  .filter((summary) => nv02PrioritySummary(summary) !== 'P0' && Number(summary.number) !== Number(issue.number))
  .map((summary) => details(summary))
  .filter((candidate) => !hasTerminalEvidence(candidate));
const next = selectNv02WorkOrder(nextIssues, { dependencies: new Map() });
console.log(JSON.stringify(next
  ? { event: 'NV02_NEXT_WORK_ORDER_READY', issue: next.issue.number, priority: next.result.priority, resourceScope: next.result.resourceScope }
  : { event: 'NV02_READY_NO_ELIGIBLE_WORK', ...noEligibleNv02Work() }));
if (result !== 'DONE') process.exitCode = 2;
