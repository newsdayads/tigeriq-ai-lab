import {createHash} from 'node:crypto';
import {selectIdleWorkers} from './worker-selection.mjs';
import {getViewportPolicy} from './viewport-policy.mjs';
import {runBrowserAudit} from './browser-audit-adapter.mjs';

const seenHandoffs=new Set();
const DEFAULT_CODING_URL='http://100.97.23.87:8797';

export function normalizeFailure(failure){
  if(typeof failure==='string')return failure;
  return `${String(failure?.code||'UNKNOWN')}@${String(failure?.viewport||'cycle')}`;
}

export function failureIdentity(targetUrl,auditResult){
  const failures = auditResult?.failures?.length ? auditResult.failures : [auditResult?.error||auditResult?.status||'unknown'];
  const normalized = failures.map(normalizeFailure).sort();
  const payload = JSON.stringify({targetUrl, failures: normalized});
  return createHash('sha256').update(payload).digest('hex');fy({targetUrl,normalized})).digest('hex');
}

function isMaterialFailure(auditResult){
  return auditResult?.status==='audit_failed'||auditResult?.sweepVerified!==true;
}

async function enqueueRepairHandoff(handoff,{fetchImpl=fetch,codingUrl=DEFAULT_CODING_URL}={}){
  const status=await fetchImpl(codingUrl+'/api/status',{cache:'no-store'});
  if(!status.ok)throw new Error(`CODING_STATUS_HTTP_${status.status||'ERROR'}`);
  const snapshot=await status.json();
  const token='WEB_AUDIT_DEDUP_KEY='+handoff.dedupeKey;
  const existing=(snapshot.objectives||[]).find(item=>String(item?.objective||'').includes(token));
  if(existing){
    return {queued:false,deduped:true,existingObjectiveId:existing.id||null};
  }

  const objective=[
    'TIGERIQ_WEB_AUDIT_REPAIR_HANDOFF_V1',
    token,
    'SOURCE_ISSUE=#658',
    'TARGET='+handoff.target,
    'AUDITOR_EMPLOYEE='+handoff.worker.employee_id,
    'AUDITOR_RESOURCE='+handoff.worker.resource_id,
    'IMPLEMENTER_MUST_NOT_EQUAL='+handoff.worker.employee_id,
    'FAILURES='+JSON.stringify((handoff.audit.failures||[]).map(normalizeFailure)),
    'ACTION=Investigate current main, deduplicate against #658 and existing repair work, then repair only the evidenced Web Control audit defect. Branch -> exact-head checks -> independent reviewer distinct from implementer -> guarded merge. No APP Chrome/Chrome Controller/Worker Utility mutation. No direct main/Production/paid/credential/security/destructive action.'
  ].join('\n');

  const created=await fetchImpl(codingUrl+'/api/objectives',{
    method:'POST',
    headers:{'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify({objective,priority:'P1'})
  });
  if(!created.ok)throw new Error(`CODING_REPAIR_INTAKE_HTTP_${created.status||'ERROR'}`);
  const receipt=await created.json();
  if(!receipt?.id)throw new Error('CODING_REPAIR_RECEIPT_MISSING');
  return {queued:true,deduped:false,receipt};
}

export async function processRepairHandoff(targetUrl,cycleIndex=0,options={}){
  const fetchImpl=options.fetchImpl||fetch;
  const selectWorkers=options.selectWorkers||((selectionOptions)=>selectIdleWorkers(selectionOptions));
  const runAudit=options.runAudit||runBrowserAudit;
  const workers=await selectWorkers({fetchImpl,...(options.workerSelectionOptions||{})});
  const worker=workers[0];
  if(!worker)throw new Error('AUDIT_WORKER_SELECTION_EMPTY');

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

  if(!isMaterialFailure(auditResult))return {...handoff,status:'PASS',repair:null};
  if(seenHandoffs.has(dedupeKey)){
    return {...handoff,status:'REPAIR_DEDUPED',repair:{queued:false,deduped:true,source:'process-memory'}};
  }

  const repair=await enqueueRepairHandoff(handoff,{fetchImpl,codingUrl:options.codingUrl||DEFAULT_CODING_URL});
  seenHandoffs.add(dedupeKey);
  return {...handoff,status:repair.queued?'REPAIR_ENQUEUED':'REPAIR_DEDUPED',repair};
}
