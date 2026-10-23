// GH-5144: inspect GitHub main CI without creating a second scheduler or queue.
// Pure decision module; network, durable receipts and remediation stay in Core.
export const REQUIRED_MAIN_CI_WORKFLOWS=Object.freeze([
  'CI','WO-014 Queue Hygiene','WO-012/013 Vercel Online Verify'
]);
export const MAIN_CI_GRACE_MS=30*60*1000;
const SHA=/^[a-f0-9]{40}$/i;
const text=x=>String(x??'').trim();
const normalizedDate=x=>{const d=Date.parse(text(x));return Number.isFinite(d)?d:null;};

export function assessMainCiGate({
  mainSha='',commitAt='',workflowRuns=null,nowMs=Date.now(),
  graceMs=MAIN_CI_GRACE_MS,
}={}){
  const sha=text(mainSha).toLowerCase();
  const stamp=normalizedDate(commitAt),validNow=Number.isFinite(nowMs)?nowMs:Date.now();
  // No trustworthy commit age or well-formed source identity: never invent a failure.
  if(!SHA.test(sha)||stamp===null||!Array.isArray(workflowRuns)||stamp>validNow+60000)
    return {state:'UNKNOWN',mainSha:SHA.test(sha)?sha:null,reason:'MAIN_CI_SOURCE_UNVERIFIED',runs:[],ageMs:null};
  const ageMs=Math.max(0,validNow-stamp);
  const relevant=workflowRuns.filter(run=>run&&run.event==='push'&&run.head_branch==='main'&&
    text(run.head_sha).toLowerCase()===sha);
  const rows=REQUIRED_MAIN_CI_WORKFLOWS.map(name=>{
    const matches=relevant.filter(run=>run.name===name)
      .sort((a,b)=>Number(b.id||0)-Number(a.id||0));
    const run=matches[0];
    if(!run)return {name,phase:'MISSING',runId:null,conclusion:null,sourceSha:sha};
    const status=text(run.status).toLowerCase(),conclusion=text(run.conclusion).toLowerCase();
    const phase=status==='completed'?(conclusion==='success'?'SUCCESS':'FAILED'):'IN_PROGRESS';
    const url=text(run.html_url);
    return {name,phase,runId:Number.isSafeInteger(Number(run.id))?Number(run.id):null,
      conclusion:conclusion||null,sourceSha:sha,
      ...(new RegExp('^https://github\\.com/newsdayads/tigeriq-ai-lab/actions/runs/[0-9]+$').test(url)?{url}:{})};
  });
  const failed=rows.filter(row=>row.phase==='FAILED');
  const pending=rows.filter(row=>row.phase!=='SUCCESS'&&row.phase!=='FAILED');
  const state=failed.length?'FAILED':!pending.length?'PASS':ageMs>=graceMs?'STALLED':'WAITING';
  return {state,mainSha:sha,ageMs,runs:rows,
    affected:failed.length?failed.map(x=>x.name):pending.map(x=>x.name),
    reason:failed.length?'MAIN_CI_REQUIRED_CHECK_FAILED':state==='STALLED'?'MAIN_CI_REQUIRED_CHECK_OVERDUE':
      state==='WAITING'?'MAIN_CI_CHECK_PENDING':'MAIN_CI_CHECKS_PASSED'};
}
