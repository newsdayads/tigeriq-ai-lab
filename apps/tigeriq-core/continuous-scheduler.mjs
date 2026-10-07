import { createHash } from 'node:crypto';

const PRIORITY_ORDER=Object.freeze({P1:0,P2:1,P3:2,P4:3,P5:4});
const RUNNABLE_STATES=new Set(['ready','runnable','queued','waiting_resource']);
const TERMINAL_STATES=new Set(['done','completed','closed','cancelled','canceled','superseded']);
const RECONCILE_EVENTS=new Set(['task_done','task_failed','task_blocked','resource_free','health_change','new_work']);

function text(value=''){return String(value??'').trim();}
function state(value=''){return text(value).toLowerCase();}
function bool(value){return value===true;}
function num(value,fallback=0){const out=Number(value);return Number.isFinite(out)?out:fallback;}

function stableHash(value){
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function priorityRank(value){
  const key=text(value).toUpperCase();
  return Object.prototype.hasOwnProperty.call(PRIORITY_ORDER,key)?PRIORITY_ORDER[key]:Number.POSITIVE_INFINITY;
}

function normalizeSkills(value){
  return [...new Set((Array.isArray(value)?value:[]).map(text).filter(Boolean))].sort();
}

function dependencyReady(task,tasksById){
  const deps=Array.isArray(task?.dependencies)?task.dependencies.map(text).filter(Boolean):[];
  return deps.every(id=>TERMINAL_STATES.has(state(tasksById.get(id)?.state)));
}

function leaseActive(task,nowMs){
  const until=Date.parse(text(task?.lease_until||task?.leaseUntil));
  return Boolean(text(task?.lease_id||task?.leaseId))&&Number.isFinite(until)&&until>nowMs;
}

export function resourceFitScore(task={},resource={}){
  const requiredCapability=text(task.capability).toLowerCase();
  const caps=(Array.isArray(resource.capability)?resource.capability:[resource.capability]).map(v=>text(v).toLowerCase()).filter(Boolean);
  if(requiredCapability&&!caps.includes(requiredCapability))return -1;
  const wanted=normalizeSkills(task.skills);
  const available=new Set(normalizeSkills(resource.skills));
  const matched=wanted.filter(skill=>available.has(skill)).length;
  const skillRatio=wanted.length?matched/wanted.length:1;
  const health=state(resource.health);
  const healthScore=health==='healthy'||health==='ready'||health==='online'?1:health==='degraded'?0.4:0;
  const success=Math.max(0,Math.min(1,num(resource.success_rate??resource.successRate,1)));
  const latency=Math.max(0,num(resource.latency_ms??resource.latencyMs,0));
  const latencyScore=1/(1+latency/1000);
  return Number((skillRatio*4+healthScore*3+success*2+latencyScore).toFixed(6));
}

export function rankBacklogTask(task={},resource={},nowMs=Date.now()){
  const created=Date.parse(text(task.created_at||task.createdAt||task.updated_at||task.updatedAt));
  const ageHours=Number.isFinite(created)?Math.max(0,(nowMs-created)/3600000):0;
  return Object.freeze({
    priority:priorityRank(task.priority),
    criticalPath:bool(task.critical_path??task.criticalPath)?1:0,
    unblockValue:Math.max(0,num(task.unblock_value??task.unblockValue,0)),
    ageHours:Number(ageHours.toFixed(6)),
    resourceFit:resourceFitScore(task,resource),
    taskId:text(task.id),
    resourceId:text(resource.id),
  });
}

export function compareRank(a,b){
  if(a.priority!==b.priority)return a.priority-b.priority;
  if(a.criticalPath!==b.criticalPath)return b.criticalPath-a.criticalPath;
  if(a.unblockValue!==b.unblockValue)return b.unblockValue-a.unblockValue;
  if(a.ageHours!==b.ageHours)return b.ageHours-a.ageHours;
  if(a.resourceFit!==b.resourceFit)return b.resourceFit-a.resourceFit;
  return a.taskId.localeCompare(b.taskId)||a.resourceId.localeCompare(b.resourceId);
}

export function dispatchIdentity(task={}){
  return [
    text(task.objective_id||task.objectiveId),
    text(task.id),
    text(task.resource_scope||task.resourceScope),
  ].join('|');
}

export function duplicateDispatchGuard(task={},activeDispatchKeys=[]){
  const key=dispatchIdentity(task);
  const active=new Set((Array.isArray(activeDispatchKeys)?activeDispatchKeys:[]).map(text));
  return Object.freeze({key,allowed:Boolean(key)&&!active.has(key),reason:active.has(key)?'duplicate_dispatch':'unique_dispatch'});
}

export function noProgressSignature({tasks=[],resources=[]}={}){
  const snapshot={
    tasks:(Array.isArray(tasks)?tasks:[]).map(task=>({
      id:text(task.id),
      state:state(task.state),
      priority:text(task.priority).toUpperCase(),
      blocked_reason:text(task.blocked_reason||task.blockedReason),
      lease_id:text(task.lease_id||task.leaseId),
      lease_until:text(task.lease_until||task.leaseUntil),
    })).sort((a,b)=>a.id.localeCompare(b.id)),
    resources:(Array.isArray(resources)?resources:[]).map(resource=>({
      id:text(resource.id),
      health:state(resource.health),
      current_work:text(resource.current_work||resource.currentWork),
    })).sort((a,b)=>a.id.localeCompare(b.id)),
  };
  return stableHash(snapshot);
}

export function noProgressGuard({previousSignature='',currentSignature='',repeatCount=0,maxRepeats=1}={}){
  const repeated=Boolean(previousSignature)&&previousSignature===currentSignature;
  const nextRepeatCount=repeated?Math.max(0,Math.trunc(num(repeatCount)))+1:0;
  return Object.freeze({
    repeated,
    repeatCount:nextRepeatCount,
    blocked:repeated&&nextRepeatCount>Math.max(0,Math.trunc(num(maxRepeats,1))),
    reason:repeated?'same_no_progress_signature':'progress_or_state_change',
  });
}

export function releaseBlockedStepLease(task={}){
  if(state(task.state)!=='blocked')return Object.freeze({released:false,task:{...task},event:null});
  const hadLease=Boolean(text(task.lease_id||task.leaseId)||text(task.assigned_resource||task.assignedResource));
  const next={
    ...task,
    lease_id:null,
    lease_until:null,
    assigned_resource:null,
  };
  return Object.freeze({
    released:hadLease,
    task:Object.freeze(next),
    event:Object.freeze({
      type:'lease_released_for_blocked_step',
      task_id:text(task.id),
      resource_scope:text(task.resource_scope||task.resourceScope),
    }),
  });
}

export function reconcileSchedulerEvent(event={}){
  const type=state(event.type);
  return Object.freeze({
    reconcile:RECONCILE_EVENTS.has(type),
    type,
    reason:RECONCILE_EVENTS.has(type)?'event_requires_reconcile':'event_ignored',
  });
}

export function selectDispatch({
  tasks=[],
  resources=[],
  activeDispatchKeys=[],
  nowMs=Date.now(),
}={}){
  const taskRows=Array.isArray(tasks)?tasks:[];
  const resourceRows=Array.isArray(resources)?resources:[];
  const tasksById=new Map(taskRows.map(task=>[text(task.id),task]));
  const freeResources=resourceRows.filter(resource=>{
    const health=state(resource.health);
    return ['healthy','ready','online'].includes(health)&&!text(resource.current_work||resource.currentWork);
  });

  const candidates=[];
  for(const task of taskRows){
    if(!RUNNABLE_STATES.has(state(task.state)))continue;
    if(priorityRank(task.priority)===Number.POSITIVE_INFINITY)continue;
    if(bool(task.owner_hold??task.ownerHold)||bool(task.hard_gate??task.hardGate))continue;
    if(text(task.blocked_reason||task.blockedReason))continue;
    if(leaseActive(task,nowMs))continue;
    if(!dependencyReady(task,tasksById))continue;
    const guard=duplicateDispatchGuard(task,activeDispatchKeys);
    if(!guard.allowed)continue;
    for(const resource of freeResources){
      const rank=rankBacklogTask(task,resource,nowMs);
      if(rank.resourceFit<0)continue;
      candidates.push({task,resource,rank,dispatchKey:guard.key});
    }
  }
  candidates.sort((a,b)=>compareRank(a.rank,b.rank));
  if(!candidates.length)return Object.freeze({action:'idle',reason:'no_eligible_dispatch',candidate:null});
  const best=candidates[0];
  return Object.freeze({
    action:'dispatch',
    reason:'highest_ranked_eligible_work',
    candidate:Object.freeze({
      taskId:text(best.task.id),
      resourceId:text(best.resource.id),
      dispatchKey:best.dispatchKey,
      rank:best.rank,
    }),
  });
}

export function workStealPlan({
  tasks=[],
  resources=[],
  activeDispatchKeys=[],
  nowMs=Date.now(),
  maxDispatches=1,
}={}){
  const mutableTasks=(Array.isArray(tasks)?tasks:[]).map(task=>({...task}));
  const mutableResources=(Array.isArray(resources)?resources:[]).map(resource=>({...resource}));
  const active=[...(Array.isArray(activeDispatchKeys)?activeDispatchKeys:[])];
  const dispatches=[];
  const limit=Math.max(0,Math.trunc(num(maxDispatches,1)));
  for(let i=0;i<limit;i++){
    const selected=selectDispatch({tasks:mutableTasks,resources:mutableResources,activeDispatchKeys:active,nowMs});
    if(selected.action!=='dispatch')break;
    dispatches.push(selected.candidate);
    active.push(selected.candidate.dispatchKey);
    const task=mutableTasks.find(row=>text(row.id)===selected.candidate.taskId);
    const resource=mutableResources.find(row=>text(row.id)===selected.candidate.resourceId);
    if(task){task.state='dispatching';task.assigned_resource=selected.candidate.resourceId;}
    if(resource)resource.current_work=selected.candidate.taskId;
  }
  return Object.freeze({
    dispatches:Object.freeze(dispatches),
    idle:dispatches.length===0,
    reason:dispatches.length?'work_stolen_or_dispatched':'no_eligible_dispatch',
  });
}
