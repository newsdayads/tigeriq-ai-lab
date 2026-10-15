// GH-4858 S01: canonical, read-only *source* projection contract.
// Not a runtime/lease attestation. GitHub issue text cannot prove active execution.
import { workOrderChecklistSteps } from './work-order-checklist-hard-gate.mjs';

const rec = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const FIELD = /^[A-Z][A-Z0-9_]*$/;
const SHA = /^[a-f\d]{40}$/i;
const ISSUE_URL = /^https:\/\/github\.com\/newsdayads\/tigeriq-ai-lab\/issues\/[1-9]\d*$/;
const BLOCKED = /(?:^|_)(?:BLOCKED|EXTERNAL_WAIT|WAIT_DEPENDENCY|NO_GO)(?:_|$)/;
const OWNER_WAIT = /(?:^|_)(?:OWNER_GATE|OWNER_REVIEW_REQUIRED|WAIT_OWNER|WAIT_ANH_SON)(?:_|$)/;

function field(body,key){
  if(!FIELD.test(key))return '';
  return String(body||'').match(new RegExp('^'+key+'=([^\\r\\n]+)$','m'))?.[1]?.trim()||'';
}
function isSystem(issue,scope){
  const title=String(issue.title||'').toUpperCase();
  const labels=(Array.isArray(issue.labels)?issue.labels:[]).map(x=>String(x?.name||x).toUpperCase());
  return /\[(?:CENTRAL|REGISTRY|STATE|POLICY|SYSTEM|QUẢN TRỊ|ĐIỀU PHỐI)\]/.test(title)
    || /(?:^|_)(?:CENTRAL|REGISTRY|POLICY|SYSTEM)(?:_|$)/.test(scope)
    || labels.some(x=>/(?:SYSTEM|CENTRAL|POLICY)/.test(x));
}
export function projectCanonicalWorkOrder(issue, source = {}){
  if(!rec(issue)||!Number.isSafeInteger(issue.number)||issue.number<1||
      typeof issue.body!=='string'||!['open','closed'].includes(issue.state))
    return {ok:false,reason:'ISSUE_READBACK_REQUIRED'};
  const body=issue.body;
  const scope=field(body,'RESOURCE_SCOPE');
  const state=field(body,'CURRENT_STATE').toUpperCase();
  const doneDeclared=field(body,'DONE').toLowerCase()==='true';
  const claimedActive=field(body,'ACTIVE_EXECUTION').toLowerCase()==='true';
  const system=isSystem(issue,scope);
  const closed=issue.state==='closed';
  const {found,steps}=workOrderChecklistSteps(body);
  const duplicate=steps.length!==new Set(steps.map(x=>x.id)).size;
  const progressValid=found&&steps.length>0&&!duplicate;
  const progressCompleted=progressValid?steps.filter(x=>x.checked).length:null;
  const progressTotal=progressValid?steps.length:null;
  const percent=progressValid&&progressCompleted<progressTotal
    ?Math.round(100*progressCompleted/progressTotal):null;
  const updatedAt=Number.isFinite(Date.parse(issue.updated_at||''))?issue.updated_at:null;
  const sourceSha=typeof source.sourceSha==='string'&&SHA.test(source.sourceSha)?source.sourceSha.toLowerCase():null;
  const sourceComplete=source.complete===true&&source.stale===false&&!!sourceSha&&
    updatedAt!==null&&source.issueUpdatedAt===updatedAt;
  const sourceState=sourceComplete?'COMPLETE':source.complete===false?'TRUNCATED':'UNVERIFIED';
  let status='WAITING';
  if(closed) status='CLOSED_UNVERIFIED';
  else if(system) status='SYSTEM';
  else if(BLOCKED.test(state)||field(body,'CURRENT_ATTEMPT_END')==='WAIT_DEPENDENCY_NOT_DONE') status='BLOCKED';
  else if(OWNER_WAIT.test(state)) status='WAIT_OWNER';
  else if(claimedActive) status='RUNNING_UNVERIFIED';
  else if(/(?:^|_)READY(?:_|$)/.test(state)) status='READY_UNCLAIMED';
  // Never set RUNNING or DONE from GitHub text, comment, checklist, or an absent lease.
  const priority=field(body,'PRIORITY').match(/^P[1-5]$/)?.[0]||
    String(issue.title||'').match(/\[(P[1-5])\]/i)?.[1]?.toUpperCase()||'UNVERIFIED';
  return {
    ok:true,version:'work-center-contract-v1',number:issue.number,
    title:String(issue.title||'').slice(0,300),priority,resourceScope:scope||null,
    workKind:system?'SYSTEM':field(body,'TIGERIQ_EXECUTABLE').toLowerCase()==='true'?'WORK':'UNVERIFIED',
    status,closed,doneDeclared,claimedActive,runtimeVerified:false,leaseOwned:false,
    currentStep:field(body,'CURRENT_STEP')||null,nextAction:field(body,'NEXT_ACTION')||null,
    checklistFound:found,checklistValid:progressValid,
    progressCompleted,progressTotal,progressPercent:percent,
    progressProof:'CHECKBOX_READBACK_ONLY_NOT_RUNTIME_ACCEPTANCE',
    steps:progressValid?steps.map(x=>({id:x.id,checked:x.checked,
      evidenceUrls:x.evidenceUrls.filter(u=>u.startsWith('https://')).slice(0,12)})):[],
    evidenceUrl:ISSUE_URL.test(String(issue.html_url||''))?issue.html_url:null,
    updatedAt,source:{state:sourceState,complete:sourceComplete,stale:!sourceComplete,sha:sourceSha,
      issueUpdatedAt:updatedAt}
  };
}
