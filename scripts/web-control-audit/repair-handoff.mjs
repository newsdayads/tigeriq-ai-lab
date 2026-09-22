import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {selectIdleWorker} from './worker-selection.mjs';
import {getViewportPolicy} from './viewport-policy.mjs';
import {runBrowserAudit} from './browser-audit-adapter.mjs';

const DEFAULT_LEDGER=process.env.TIGERIQ_WEB_AUDIT_HANDOFF_LEDGER||'D:/TigerIQ/Runtime/WebAudit/658-repair-handoffs.jsonl';
const DEFAULT_CODING_URL=process.env.TIGERIQ_CODING_LANE_URL||'http://100.97.23.87:8797/api/objectives';

function readLedger(file){
  if(!file||!fs.existsSync(file)) return [];
  return fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).flatMap(line=>{
    try{return [JSON.parse(line)]}catch{return []}
  });
}

function appendLedger(file,row){
  if(!file) return;
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.appendFileSync(file,JSON.stringify(row)+'\n');
}

export function normalizeMaterialFailures(auditResult){
  return [...new Set((auditResult?.failures||[]).map(item=>
    `${String(item?.code||'UNKNOWN')}@${String(item?.viewport||'cycle')}`
  ))].sort();
}

export function materialFailureSignature(targetUrl,auditResult){
  const normalized=normalizeMaterialFailures(auditResult);
  return createHash('sha256').update(JSON.stringify({targetUrl,failures:normalized})).digest('hex');
}

function buildRepairObjective({targetUrl,signature,auditor,failures}){
  return `GitHub autonomous repair handoff for canonical issue #658.
AUDIT_FAILURE_SIGNATURE=${signature}
AUDIT_TARGET=${targetUrl}
AUDITOR_EMPLOYEE=${auditor.employee_id}
AUDITOR_RESOURCE=${auditor.resource_id}
IMPLEMENTER_MUST_NOT_EQUAL=${auditor.employee_id}
PRIORITY=P1
RESOURCE_SCOPE=WEB_CONTROL_HOURLY_AUDIT_REPAIR_${signature.slice(0,12)}
TIGERIQ_EXECUTABLE=true
ZERO_COST=true
NO_PC01_SHELL=true
NO_DIRECT_MAIN=true
NO_PRODUCTION_RELEASE=true
NO_PAID_COST=true
NO_CREDENTIAL_CHANGE=true
NO_DESTRUCTIVE=true
NO_BROWSER_AUTH=true
ALLOW_PATH_PREFIX=scripts/chrome-devtools-mcp-smoke.mjs,scripts/web-control-audit/hourly-runner.mjs,scripts/web-control-audit/repair-handoff.mjs,scripts/web-control-audit/resolution-matrix.mjs,scripts/web-control-audit/browser-audit-adapter.mjs,scripts/web-control-audit/viewport-policy.mjs,scripts/web-control-audit/worker-selection.mjs,tests/web-control-audit.test.mjs,tests/web-control-audit-repair.test.mjs

Material browser failures: ${failures.join(', ')}.
Repair only the evidenced Web Control audit defect. Deduplicate against open #658 repair work before mutation. Branch -> exact-head checks -> independent reviewer distinct from implementer -> guarded merge. Do not touch APP Chrome/Chrome Controller/Worker Utility.`;
}

export async function processRepairHandoff(targetUrl,cycleIndex,options={}){
  const selectWorker=options.selectWorker||selectIdleWorker;
  const auditRunner=options.auditRunner||runBrowserAudit;
  const fetchImpl=options.fetchImpl||fetch;
  const ledgerPath=options.ledgerPath===undefined?DEFAULT_LEDGER:options.ledgerPath;
  const codingUrl=options.codingUrl||DEFAULT_CODING_URL;

  const auditor=await selectWorker(options.workerSelectionOptions||{});
  const policy=getViewportPolicy(cycleIndex);
  const audit=await auditRunner(targetUrl,policy.viewports,options.auditOptions||{});

  const base={
    schema:'TIGERIQ_WEB_AUDIT_CYCLE_V1',
    target:targetUrl,
    cycleIndex,
    auditor,
    viewportLabels:policy.viewports.map(view=>view.label),
    audit
  };

  if(audit.pass===true && audit.status==='audit_complete'){
    return {...base,status:'PASS',repair:null};
  }

  const failures=normalizeMaterialFailures(audit);
  if(failures.length===0) failures.push('AUDIT_FAILED_WITHOUT_CODE@cycle');
  const signature=materialFailureSignature(targetUrl,{...audit,failures:failures.map(value=>{
    const [code,viewport='cycle']=value.split('@');
    return {code,viewport};
  })});
  const previous=readLedger(ledgerPath).find(row=>row.failureSignature===signature);
  if(previous){
    return {...base,status:'REPAIR_DEDUPED',repair:previous};
  }

  const objective=buildRepairObjective({targetUrl,signature,auditor,failures});
  const response=await fetchImpl(codingUrl,{
    method:'POST',
    headers:{'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify({objective,priority:'P1'})
  });
  if(!response.ok) throw new Error(`CODING_HANDOFF_HTTP_${response.status||'ERROR'}`);
  const receipt=await response.json();
  if(!receipt?.id) throw new Error('CODING_HANDOFF_RECEIPT_MISSING');

  const repair={
    schema:'TIGERIQ_WEB_AUDIT_REPAIR_HANDOFF_V1',
    failureSignature:signature,
    objectiveId:receipt.id,
    target:targetUrl,
    auditorEmployeeId:auditor.employee_id,
    auditorResourceId:auditor.resource_id,
    failures,
    status:'POSTED_TO_CODING_LANE',
    createdAt:new Date().toISOString()
  };
  appendLedger(ledgerPath,repair);
  return {...base,status:'REPAIR_ENQUEUED',repair};
}
