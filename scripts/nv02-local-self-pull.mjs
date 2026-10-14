import { execFileSync } from 'node:child_process';
import {
  NV02_LOCAL_GITHUB_SELF_PULL,
  buildNv02LocalSelfPullPrompt,
  claimNv02WorkOrder,
  noEligibleNv02Work,
  selectNv02WorkOrder,
  releaseNv02WorkOrder,
  nv02PrioritySummary,
  activeResourceScopes,
  activeNv02Lease,
  resourceOwnershipConflict,
  nv02LeaseAuthority,
  nv02TakeoverStatus,
  nv02HasTerminalEvidence,
  nv02AuthoritativeResumeGuard,
  releaseStaleAssigneeLease,
} from '../apps/tigeriq-core/nv02-local-self-pull.mjs';
import { reconcileStaleDependency } from '../apps/tigeriq-core/dependency-reconcile.mjs';
import { completionProof } from '../apps/shared/work-center-history.mjs';
import { workOrderChecklistGate } from '../apps/tigeriq-core/work-order-checklist-hard-gate.mjs';
import { syncAcceptedChecklistStep } from '../apps/tigeriq-core/work-order-step-autosync.mjs';

const OWNER = 'newsdayads';
const REPO = 'tigeriq-ai-lab';
const CONTROLLER = process.env.TIGERIQ_CHROME_CONTROLLER_URL || 'http://127.0.0.1:8798';
const WORKER = 'NV02';
const POLL_MS = 15_000;
const TIMEOUT_MS = 30 * 60 * 1000;
const GITHUB_CLI_TIMEOUT_MS = 60_000;
const CONTROLLER_REQUEST_TIMEOUT_MS = 30_000;

function gh(args) {
  return JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: GITHUB_CLI_TIMEOUT_MS }));
}
function issueComments(number) {
  const pages = gh([`repos/${OWNER}/${REPO}/issues/${number}/comments?per_page=100`, '--paginate', '--slurp']);
  return pages.flat();
}
function activeIssueComments() {
  const pages = gh([`repos/${OWNER}/${REPO}/issues/comments?per_page=100`, '--paginate', '--slurp']);
  return pages.flat();
}
function postComment(number, body) {
  if (body === null) return issueComments(number);
  return gh([`repos/${OWNER}/${REPO}/issues/${number}/comments`, '-X', 'POST', '-f', `body=${body}`]);
}
function summaries() {
  const pages = gh([`repos/${OWNER}/${REPO}/issues?state=open&per_page=100&sort=updated&direction=desc`, '--paginate', '--slurp']);
  return pages.flat().filter((issue) => !issue.pull_request).map(({ number, title, html_url, state, updated_at }) => ({ number, title, html_url, state, updated_at }));
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
function assertLeaseOwnership(issue, lease) {
  const assigned = nv02LeaseAuthority(issue, lease);
  if (!assigned.valid) throw new Error(`NV02_WRITE_GUARD_AUTHORITY_INVALID:${issue.number}:${assigned.reason}`);
  const own = activeNv02Lease(issueComments(issue.number));
  const live = nv02LeaseAuthority(issue, own || {});
  if (!own || own.LEASE_ID !== lease.leaseId || !live.valid) throw new Error(`NV02_WRITE_GUARD_LEASE_LOST:${issue.number}:${live.reason}`);
  const conflict = resourceOwnershipConflict(issue, activeIssueComments(), { leaseId: lease.leaseId });
  if (conflict) throw new Error(`NV02_WRITE_GUARD_SCOPE_HELD:${issue.number}:${conflict.resourceScope}`);
  return true;
}
async function reconcile(issue, lease) {
  const refs = String(issue.body || '').match(/^DEPENDS_ON\s*=\s*(.+)$/mi)?.[1]?.split(/[ ,]+/).map((x) => Number(x.replace(/^#/, ''))).filter(Boolean) || [];
  if (!refs.length) return { action: 'NOOP' };
  const dependencies = new Map(refs.map((ref) => { const dep = gh([`repos/${OWNER}/${REPO}/issues/${ref}`]); return [ref, dep]; }));
  const existingComments = issueComments(issue.number);
  return reconcileStaleDependency({
    issue, dependencies,
    alreadyReconciled: existingComments.some((x) => String(x.body || '').includes('[DEPENDENCY_RECONCILE]')),
    assertWriteOwnership: () => assertLeaseOwnership(issue, lease),
    comment: postComment,
    updateBody: (number, body) => gh([`repos/${OWNER}/${REPO}/issues/${number}`, '-X', 'PATCH', '-f', `body=${body}`]),
    closeIssue: (number) => gh([`repos/${OWNER}/${REPO}/issues/${number}`, '-X', 'PATCH', '-f', 'state=closed']),
  });
}
// Only an independently read-back, exact-head successful CI run or an explicit
// Owner-authored acceptance can release a machine-consumable step checkpoint.
// Worker statement or arbitrary comment text is never an acceptance by itself.
const ACCEPTED_STEP_MARKER='[TIGERIQ_NV02_ACCEPTED_STEP_V1]';
function stepFields(body){
 return Object.fromEntries(String(body||'').split(/\r?\n/)
  .map(line=>line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].trim()]));
}
async function syncAcceptedNv02Comments(issue,lease,comments){
 const markers=comments.filter(c=>String(c?.body||'').startsWith(ACCEPTED_STEP_MARKER)).slice(-5);
 for(const marker of markers){
  const m=stepFields(marker.body);
  if(m.WORK_ORDER!=='#'+issue.number||m.RESOURCE_SCOPE!==lease.resourceScope||
     m.LEASE_ID!==lease.leaseId||!/^([A-Z][A-Z0-9_-]{1,15})$/.test(m.STEP_ID||''))continue;
  const expectedUrl=m.EVIDENCE_URL||'';
  const part=expectedUrl.match(/^https:\/\/github\.com\/newsdayads\/tigeriq-ai-lab\/issues\/(\d+)#issuecomment-(\d+)$/i);
  if(!part||Number(part[1])!==Number(issue.number))continue;
  if(workOrderChecklistGate(issue,{stepId:m.STEP_ID,expectedEvidenceUrl:expectedUrl,requireAll:false}).ok)continue;
  const result=await syncAcceptedChecklistStep({
   issueNumber:issue.number,stepId:m.STEP_ID,evidenceUrl:expectedUrl,
   resourceScope:lease.resourceScope,leaseId:lease.leaseId,
   readIssue:async()=>details(issue),
   assertWriter:async({issue:current})=>{
    assertLeaseOwnership(current,lease);
    return {valid:true,resourceScope:lease.resourceScope,leaseId:lease.leaseId};
   },
   verifyEvidence:async()=>{
    const receipt=gh(['repos/'+OWNER+'/'+REPO+'/issues/comments/'+part[2]]);
    const f=stepFields(receipt.body);
    if(f.WORK_ORDER!=='#'+issue.number||f.RESOURCE_SCOPE!==lease.resourceScope||
       f.STEP_ID!==m.STEP_ID||f.ACCEPTANCE!=='PASS')return {verified:false};
    const ownerAcceptance=receipt?.user?.login===OWNER && f.VERIFIER==='OWNER';
    let ciAcceptance=false;
    if(/^(\d+)$/.test(f.CI_RUN_ID||'')&&/^[a-f0-9]{40}$/i.test(f.CI_HEAD_SHA||'')){
     const run=gh(['repos/'+OWNER+'/'+REPO+'/actions/runs/'+f.CI_RUN_ID]);
     ciAcceptance=run?.status==='completed'&&run?.conclusion==='success'
       &&String(run?.head_sha||'').toLowerCase()===f.CI_HEAD_SHA.toLowerCase();
    }
    if(!ownerAcceptance&&!ciAcceptance)return {verified:false};
    return {verified:true,stepId:m.STEP_ID,evidenceUrl:expectedUrl,
     resourceScope:lease.resourceScope,workOrder:'#'+issue.number};
   },
   writeIssue:async(number,body,{expectedBody})=>{
    assertLeaseOwnership(details(issue),lease);
    const current=details(issue);
    if(current.state!=='open'||current.body!==expectedBody)throw Error('SOURCE_CHANGED_BEFORE_CHECKBOX_PATCH');
    gh(['repos/'+OWNER+'/'+REPO+'/issues/'+number,'-X','PATCH','-f','body='+body]);
   },
  });
  if(!result.ok)throw Error('CHECKLIST_AUTOSYNC_DENIED:'+result.reason);
  console.log(JSON.stringify({event:'NV02_ACCEPTED_STEP_CHECKED',issue:issue.number,stepId:m.STEP_ID,
   readbackVerified:result.readbackVerified,alreadyChecked:result.alreadyChecked}));
  return result; // At most one write per poll and lease check.
 }
 return null;
}

async function controllerDispatch(issue, lease) {
  assertLeaseOwnership(issue, lease);
  const response = await fetch(`${CONTROLLER}/api/workers/NV02/dispatch`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(CONTROLLER_REQUEST_TIMEOUT_MS),
    body: JSON.stringify({ text: buildNv02LocalSelfPullPrompt(issue, lease), navigate: false,
      job: { issueRef: issue.html_url, title: `#${issue.number} - ${issue.title}`, source: 'NV02_LOCAL_SELF_PULL' } }),
  });
  if (!response.ok) throw new Error(`NV02_DISPATCH_HTTP_${response.status}:${await response.text()}`);
  return response.json();
}
function terminal(issue, comments) {
  const text = comments.map((x) => String(x.body || '')).join('\n');
  // Never release a scoped lease as DONE from a comment or GitHub closure alone.
  // Only V2 validated closed-completed with all checked, linked steps qualifies.
  if (completionProof(issue).verified && workOrderChecklistGate(issue,{requireAll:true}).ok) return 'DONE';
  if (/STATE=BLOCKED/i.test(text)) return 'BLOCKED';
  return null;
}
function hasTerminalEvidence(issue) {
  return nv02HasTerminalEvidence(issue, issueComments(issue.number));
}

async function setIdle() {
  const response = await fetch(`${CONTROLLER}/api/utility/workers/NV02/idle`, { method: 'POST', signal: AbortSignal.timeout(CONTROLLER_REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`NV02_IDLE_HTTP_${response.status}:${await response.text()}`);
  return response.json();
}

console.log(JSON.stringify({ event: 'NV02_COMMAND_02', mode: 'SELF_PULL', policy: NV02_LOCAL_GITHUB_SELF_PULL }));
const candidateIssues = summaries()
  .filter((summary) => nv02PrioritySummary(summary) !== 'P0')
  .map((summary) => details(summary));
const candidateDependencies = new Map();
for (const candidate of candidateIssues) for (const [id, ready] of dependencyMap(candidate)) candidateDependencies.set(id, ready);
const candidateGlobalComments = activeIssueComments();
const candidateHeldScopes = new Set();
for (const scope of activeResourceScopes(candidateGlobalComments)) candidateHeldScopes.add(scope);
const candidateTakeovers = new Map(candidateIssues.map((candidate) => [
  Number(candidate.number),
  nv02TakeoverStatus(candidate, issueComments(candidate.number)),
]));
const selected = selectNv02WorkOrder(candidateIssues
  .filter((issue) => !hasTerminalEvidence(issue)), {
    dependencies: candidateDependencies,
    heldScopes: candidateHeldScopes,
    takeoverStatuses: candidateTakeovers,
  });
if (!selected) { await setIdle(); console.log(JSON.stringify({ event: 'NV02_READY_NO_ELIGIBLE_WORK', ...noEligibleNv02Work(), idle: 'DURABLE' })); process.exit(0); }
const issue = selected.issue;
const takeover = selected.result.takeover;
if (takeover?.needsRelease) {
  const released = await releaseStaleAssigneeLease({ issue, takeover, postComment });
  console.log(JSON.stringify({ event: 'NV02_STALE_ASSIGNEE_RELEASED', issue: issue.number, ...released }));
}
const lease = await claimNv02WorkOrder({
  issue,
  comments: issueComments(issue.number),
  allComments: activeIssueComments(),
  refreshAllComments: async () => activeIssueComments(),
  postComment,
});
if (!lease) throw new Error(`NV02_LEASE_BUSY_OR_LOST:${issue.number}`);
if (takeover?.eligible) {
  lease.takeoverFrom = takeover.target;
  lease.takeoverReason = takeover.reason;
}
console.log(JSON.stringify({
  event: 'TIGERIQ_NV02_LEASE_ACQUIRED', issue: issue.number, resourceScope: lease.resourceScope,
  leaseId: lease.leaseId, takeoverFrom: lease.takeoverFrom || null, takeoverReason: lease.takeoverReason || null,
}));
let result = null;
try {
  const reconcileResult = await reconcile(issue, lease);
  if (reconcileResult?.action === 'CLOSED_TERMINAL') {
    result = 'DONE';
  } else {
    const freshBeforeDispatch = details(issue);
    const guard = nv02AuthoritativeResumeGuard({
      currentWorkOrder: lease.workOrder,
      currentResourceScope: lease.resourceScope,
      currentSourceRevision: lease.sourceRevision,
      authoritativeIssue: freshBeforeDispatch,
      authoritativeComments: issueComments(issue.number),
    });
    if (!guard.valid) {
      result = guard.reason === 'AUTHORITATIVE_TERMINAL' ? 'DONE' : 'REFRESH_REQUIRED';
      console.error(JSON.stringify({
        event: 'NV02_AUTHORITATIVE_REFRESH_REQUIRED',
        issue: issue.number,
        reason: guard.reason,
        authoritativeRevision: guard.authoritativeRevision || null,
        archiveAllowed: guard.archiveAllowed === true,
      }));
    } else {
      assertLeaseOwnership(freshBeforeDispatch, lease);
      await controllerDispatch(freshBeforeDispatch, lease);
      const started = Date.now();
      while (Date.now() - started < TIMEOUT_MS) {
        const fresh = details(issue);
        const comments = issueComments(issue.number);
        await syncAcceptedNv02Comments(fresh,lease,comments);
        result = terminal(details(issue), issueComments(issue.number));
        if (result) break;
        const currentGuard = nv02AuthoritativeResumeGuard({
          currentWorkOrder: lease.workOrder,
          currentResourceScope: lease.resourceScope,
          currentSourceRevision: lease.sourceRevision,
          authoritativeIssue: fresh,
          authoritativeComments: comments,
        });
        if (!currentGuard.valid) {
          result = currentGuard.reason === 'AUTHORITATIVE_TERMINAL' ? 'DONE' : 'REFRESH_REQUIRED';
          console.error(JSON.stringify({
            event: 'NV02_AUTHORITATIVE_REFRESH_REQUIRED',
            issue: issue.number,
            reason: currentGuard.reason,
            authoritativeRevision: currentGuard.authoritativeRevision || null,
            archiveAllowed: currentGuard.archiveAllowed === true,
          }));
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      if (!result) result = 'BLOCKED';
    }
  }
} catch (error) {
  result = 'DISPATCH_BLOCKED';
  console.error(JSON.stringify({ event: 'NV02_DISPATCH_BLOCKED', issue: issue.number, error: String(error) }));
}
await releaseNv02WorkOrder({ issue, issueNumber: issue.number, leaseId: lease.leaseId, resourceScope: lease.resourceScope, state: result, postComment });
console.log(JSON.stringify({ event: 'TIGERIQ_NV02_LEASE_RELEASED', issue: issue.number, resourceScope: lease.resourceScope, leaseId: lease.leaseId, state: result }));
const nextIssues = summaries()
  .filter((summary) => nv02PrioritySummary(summary) !== 'P0' && Number(summary.number) !== Number(issue.number))
  .map((summary) => details(summary));
const nextDependencies = new Map();
for (const candidate of nextIssues) for (const [id, ready] of dependencyMap(candidate)) nextDependencies.set(id, ready);
const nextGlobalComments = activeIssueComments();
const nextHeldScopes = new Set();
for (const scope of activeResourceScopes(nextGlobalComments)) nextHeldScopes.add(scope);
const nextTakeovers = new Map(nextIssues.map((candidate) => [
  Number(candidate.number),
  nv02TakeoverStatus(candidate, issueComments(candidate.number)),
]));
const next = selectNv02WorkOrder(nextIssues.filter((candidate) => !hasTerminalEvidence(candidate)), {
  dependencies: nextDependencies,
  heldScopes: nextHeldScopes,
  takeoverStatuses: nextTakeovers,
});
console.log(JSON.stringify(next
  ? { event: 'NV02_NEXT_WORK_ORDER_READY', issue: next.issue.number, priority: next.result.priority, resourceScope: next.result.resourceScope }
  : { event: 'NV02_READY_NO_ELIGIBLE_WORK', ...noEligibleNv02Work(), idle: 'DURABLE' }));
if (!next) await setIdle();
if (result !== 'DONE') process.exitCode = 2;
