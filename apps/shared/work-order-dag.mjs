// GH #280, S4 source-only: deterministic child dependency and concurrency planning.
// Pure read-only proposal builder; does NOT acquire a lease, claim a job,
// authorize protected mutations, close GitHub issues or write control-plane state.
const STATUSES=new Set(['queued','ready','claimed','running','review','accepted','failed','blocked']);
const SHA=/^[a-f0-9]{40}$/i;

function fail(code){
  const e=new Error(code);
  e.code=code;
  throw e;
}
function id(value,what){
  const result=String(value??'').trim();
  if(!/^[a-zA-Z0-9][a-zA-Z0-9:_\-.]{0,159}$/.test(result))fail('DAG_INVALID_'+what);
  return result;
}
function path(value){
  const v=String(value??'');
  if(!v||v!==v.trim()||v.startsWith('/')||v.startsWith('./')||
     v.includes('\\')||v.includes('//')||/[\u0000-\u001f]/.test(v)||
     v.split('/').some(s=>!s||s==='.'||s==='..'))fail('DAG_UNSAFE_PATH');
  return v;
}
function unique(xs){return [...new Set(xs)];}
function scopeArray(value){
  if(!Array.isArray(value))fail('DAG_SCOPE_ARRAY_REQUIRED');
  return unique(value.map(path));
}
export function taskScopesOverlap(a,b){
  const A=path(a).replace(/\/$/,'');
  const B=path(b).replace(/\/$/,'');
  return A===B||A.startsWith(B+'/')||B.startsWith(A+'/');
}
export function taskWriteConflict(a,b){
  const scopeA=String(a?.exclusive_scope||'');
  const scopeB=String(b?.exclusive_scope||'');
  if(scopeA&&scopeB&&scopeA===scopeB)return true;
  const pathsA=a?.write_paths||[];
  const pathsB=b?.write_paths||[];
  if(!Array.isArray(pathsA)||!Array.isArray(pathsB))fail('DAG_SCOPE_ARRAY_REQUIRED');
  return pathsA.some(p=>pathsB.some(q=>taskScopesOverlap(p,q)));
}
function normalizeTask(raw,sourceRevision){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('DAG_TASK_INVALID');
  const task_id=id(raw.task_id,'TASK_ID');
  const rev=id(raw.source_revision,'SOURCE_REVISION');
  if(rev!==sourceRevision)fail('DAG_STALE_SOURCE_REVISION');
  const status=String(raw.status||'').toLowerCase();
  if(!STATUSES.has(status))fail('DAG_STATUS_INVALID');
  const depends_on=unique((Array.isArray(raw.depends_on)?raw.depends_on:fail('DAG_DEPENDENCIES_ARRAY_REQUIRED')).map(v=>id(v,'DEPENDENCY')));
  if(depends_on.includes(task_id))fail('DAG_DEPENDENCY_CYCLE');
  const write_paths=scopeArray(raw.write_paths);
  const exclusive_scope=raw.exclusive_scope? id(raw.exclusive_scope,'EXCLUSIVE_SCOPE'):'';
  if(!write_paths.length&&!exclusive_scope)fail('DAG_SCOPE_REQUIRED');
  const capability=id(raw.capability,'CAPABILITY');
  const priority=Number(raw.priority);
  if(!Number.isInteger(priority)||priority<1||priority>5)fail('DAG_PRIORITY_INVALID');
  return {
    ...raw,task_id,source_revision:rev,status,depends_on,write_paths,
    exclusive_scope,capability,priority,required:raw.required!==false,
  };
}
export function compileChildDag(children,{sourceRevision}={}){
  const revision=id(sourceRevision,'SOURCE_REVISION');
  if(!Array.isArray(children)||children.length<1||children.length>128)fail('DAG_CHILD_COUNT_INVALID');
  const tasks=children.map(x=>normalizeTask(x,revision));
  const byId=new Map();
  for(const t of tasks){
    if(byId.has(t.task_id))fail('DAG_DUPLICATE_TASK');
    byId.set(t.task_id,t);
  }
  for(const t of tasks)for(const d of t.depends_on){
    if(!byId.has(d))fail('DAG_MISSING_DEPENDENCY');
  }
  const active=new Set(),done=new Set(),order=[];
  function visit(key){
    if(active.has(key))fail('DAG_DEPENDENCY_CYCLE');
    if(done.has(key))return;
    active.add(key);
    for(const dependency of byId.get(key).depends_on)visit(dependency);
    active.delete(key);
    done.add(key);
    order.push(key);
  }
  for(const t of tasks)visit(t.task_id);
  return {sourceRevision:revision,tasks,byId,topologicalOrder:order};
}
function verifiedAcceptance(task){
  if(task.status!=='accepted')return {pass:false,reason:'CHILD_NOT_ACCEPTED'};
  const r=task.receipt;
  if(!r||typeof r!=='object'||r.accepted!==true||
     r.task_id!==task.task_id||r.source_revision!==task.source_revision)return {pass:false,reason:'CHILD_RECEIPT_UNVERIFIED'};
  if(!Array.isArray(r.evidence_refs)||!r.evidence_refs.length||
     !r.evidence_refs.every(e=>typeof e==='string'&&e.length>0&&e.length<=2048))return {pass:false,reason:'CHILD_EVIDENCE_MISSING'};
  if(task.capability==='coding'){
    const c=r.coding;
    if(!c||!SHA.test(String(c.head_sha||''))||c.ci_passed!==true||String(c.ci_head_sha||'').toLowerCase()!==c.head_sha.toLowerCase()||
      !SHA.test(String(c.merge_sha||''))||!c.pr_url?.startsWith?.('https://github.com/'))return {pass:false,reason:'CODING_MERGE_CI_UNPROVEN'};
    const review=c.review||{};
    const independent=review.approved===true&&review.reviewer_id&&review.author_id&&review.reviewer_id!==review.author_id&&
      String(review.head_sha||'').toLowerCase()===c.head_sha.toLowerCase();
    const waived=review.owner_waiver_allowed===true&&review.owner_waived===true&&
      typeof review.waiver_url==='string'&&review.waiver_url.startsWith('https://github.com/');
    if(!independent&&!waived)return {pass:false,reason:'CODING_INDEPENDENT_REVIEW_MISSING'};
  }
  return {pass:true,reason:'CHILD_ACCEPTED_WITH_EVIDENCE'};
}
export function childAcceptanceDecision(task){
  return verifiedAcceptance(task);
}
function readyTask(task,graph){
  if(!['queued','ready'].includes(task.status))return false;
  if(task.owner_gate_required===true&&task.owner_gate_accepted!==true)return false;
  return task.depends_on.every(key=>verifiedAcceptance(graph.byId.get(key)).pass);
}
function suitableResource(resource,task){
  if(!resource||resource.eligible!==true||resource.busy===true||!resource.resource_id)return false;
  const caps=Array.isArray(resource.capabilities)?resource.capabilities:[];
  return caps.includes(task.capability);
}
function assertOccupied(occupied){
  if(!Array.isArray(occupied))fail('DAG_OCCUPIED_INVALID');
  return occupied.map(x=>{
    if(!x||typeof x!=='object'||!x.resource_id||typeof x.resource_id!=='string')fail('DAG_OCCUPIED_INVALID');
    const write_paths=scopeArray(x.write_paths||[]);
    const exclusive_scope=x.exclusive_scope? id(x.exclusive_scope,'EXCLUSIVE_SCOPE'):'';
    if(!write_paths.length&&!exclusive_scope)fail('DAG_OCCUPIED_SCOPE_MISSING');
    return {resource_id:x.resource_id,write_paths,exclusive_scope};
  });
}
// Returns PROPOSALS, not atomic leases. The implementation must transactionally
// re-check these conditions with PG row locks and fencing epochs before running.
export function planReadyChildBatch(graph,{resources=[],occupied=[],limit=3}={}){
  if(!graph?.byId||!Array.isArray(graph?.tasks))fail('DAG_GRAPH_INVALID');
  if(!Array.isArray(resources)||!Number.isInteger(limit)||limit<1||limit>16)fail('DAG_PLANNER_INPUT_INVALID');
  const held=assertOccupied(occupied);
  const proposed=[];
  const candidates=graph.tasks.filter(t=>readyTask(t,graph)).sort((a,b)=>a.priority-b.priority||a.task_id.localeCompare(b.task_id));
  for(const task of candidates){
    if(proposed.length>=limit)break;
    const worker=resources.find(r=>suitableResource(r,task)&&
      !held.some(h=>h.resource_id===r.resource_id||taskWriteConflict(task,h)));
    if(!worker)continue;
    proposed.push({task_id:task.task_id,resource_id:worker.resource_id,capability:task.capability,
      source_revision:graph.sourceRevision,write_paths:[...task.write_paths],exclusive_scope:task.exclusive_scope,
      claim_state:'PROPOSED_NOT_CLAIMED'});
    held.push({resource_id:worker.resource_id,write_paths:task.write_paths,exclusive_scope:task.exclusive_scope});
  }
  return proposed;
}
export function parentFinishDecision(graph,{activeWriters=0,ownerAcceptanceRequired=false,ownerAccepted=false}={}){
  if(!graph?.byId||!Array.isArray(graph?.tasks))fail('DAG_GRAPH_INVALID');
  const missing=graph.tasks.filter(t=>t.required).map(t=>({task_id:t.task_id,...verifiedAcceptance(t)})).filter(x=>!x.pass);
  const reasons=[];
  if(missing.length)reasons.push('REQUIRED_CHILD_NOT_ACCEPTED');
  if(!Number.isInteger(activeWriters)||activeWriters<0||activeWriters!==0)reasons.push('ACTIVE_WRITER_OR_INVALID_COUNT');
  if(ownerAcceptanceRequired&&ownerAccepted!==true)reasons.push('OWNER_ACCEPTANCE_NOT_VERIFIED');
  return {canFinish:reasons.length===0,reasons,missing,requiredCount:graph.tasks.filter(x=>x.required).length,
    acceptedRequiredCount:graph.tasks.filter(x=>x.required).length-missing.length,
    sourceRevision:graph.sourceRevision,
    action:reasons.length===0?'READY_TO_RECONCILE_NOT_DONE':'KEEP_PARENT_OPEN'};
}
