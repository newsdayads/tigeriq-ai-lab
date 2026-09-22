import {createHash} from 'node:crypto';
import {selectIdleWorkers} from './worker-selection.mjs';
import {getViewportPolicy} from './viewport-policy.mjs';
import {runBrowserAudit} from './browser-audit-adapter.mjs';

const seenHandoffs=new Set();
const CODING_URL='http://100.97.23.87:8797';

function failureIdentity(targetUrl,auditResult){
  const normalized=(auditResult?.failures?.length?auditResult.failures:[auditResult?.error||auditResult?.status||'unknown'])
    .map(String)
    .sort();
  return createHash('sha256').update(JSON.stringify({targetUrl,normalized})).digest('hex');
}

function isMaterialFailure(auditResult){
  return auditResult?.status==='audit_failed'||auditResult?.sweepVerified!==true;
}

async function enqueueRepairHandoff(handoff,fetchImpl=fetch){
  const status=await fetchImpl(CODING_URL+'/api/status',{cache:'no-store'});
  if(!status.ok)throw new Error('Coding Lane status unavailable; fail closed');
  const snapshot=await status.json();
  const token='WEB_AUDIT_DEDUP_KEY='+handoff.dedupeKey;
  if((snapshot.objectives||[]).some((x)=>String(x?.objective||'').includes(token))){
    return {queued:false,deduped:true,existing:true};
  }

  const objective=[
    'TIGERIQ_WEB_AUDIT_REPAIR_HANDOFF_V1',
    token,
    'SOURCE_ISSUE=#658',
    'TARGET='+handoff.target,
    'AUDITOR_EMPLOYEE='+handoff.worker.employee_id,
    'AUDITOR_RESOURCE='+handoff.worker.resource_id,
    'FAILURES='+JSON.stringify(handoff.audit.failures||[]),
    'ACTION=Investigate current main, deduplicate against #658 and existing children, then perform only safe/reversible/zero-cost repair within the canonical Web Control audit scope. If the defect is outside that scope, report BLOCKED with evidence. Branch -> PR -> exact-head checks -> independent review; no direct main/Production/credential/security/destructive action.'
  ].join('\n');

  const created=await fetchImpl(CODING_URL+'/api/objectives',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({objective,priority:'P1'})
  });
  if(!created.ok)throw new Error('Coding Lane repair intake failed');
  return {queued:true,deduped:false,receipt:await created.json()};
}

export async function processRepairHandoff(targetUrl,cycleIndex=0,options={}){
  const fetchImpl=options.fetchImpl||fetch;
  const selectWorkers=options.selectWorkers||((impl)=>selectIdleWorkers({fetchImpl:impl}));
  const runAudit=options.runAudit||runBrowserAudit;
  const workers=await selectWorkers(fetchImpl);
  const worker=workers[0];
  const policy=getViewportPolicy(cycleIndex);
  const auditResult=await runAudit(targetUrl,policy.viewports,options.auditOptions||{});
  const dedupeKey=failureIdentity(targetUrl,auditResult);

  const handoff={
    schema:'TIGERIQ_WEB_AUDIT_HANDOFF_V1',
    dedupeKey,
    timestamp:new Date().toISOString(),
    target:targetUrl,
    cycle:cycleIndex,
    worker:{
      employee_id:worker.employee_id,
      resource_id:worker.resource_id,
      provider:worker.provider,
      model:worker.model
    },
    viewports:policy.viewports,
    audit:auditResult
  };

  if(!isMaterialFailure(auditResult))return {...handoff,repair:null};
  if(seenHandoffs.has(dedupeKey))return null;
  seenHandoffs.add(dedupeKey);
  const repair=await enqueueRepairHandoff(handoff,fetchImpl);
  return {...handoff,repair};
}
