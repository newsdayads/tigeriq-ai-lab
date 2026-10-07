export const AUTONOMY_BENCHMARK_SCHEMA='TIGERIQ_AUTONOMY_BENCHMARK_V1';
const EVENT_TYPES=new Set(['state','dispatch','job_completed','owner_nudge','duplicate_dispatch','false_parent_park','review_violation','unsafe_plan_rejected','replan_requested','replan_completed','restart_committed','restart_resumed','gate_escalation']);

function finiteNumber(value,code,{min=0}={}){
  const n=Number(value);
  if(!Number.isFinite(n)||n<min)throw new Error(code);
  return n;
}

function eventTime(event,index){
  const ms=Date.parse(String(event?.at||''));
  if(!Number.isFinite(ms))throw new Error(`BENCHMARK_EVENT_TIME_INVALID:${index}`);
  return ms;
}

function percentileNearestRank(values,p){
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b);
  const rank=Math.max(1,Math.ceil(Math.min(1,Math.max(0,Number(p)||0))*sorted.length));
  return sorted[rank-1];
}

function round(value,digits=3){
  const factor=10**digits;
  return Math.round((Number(value)+Number.EPSILON)*factor)/factor;
}

export function validateAutonomyBenchmarkFixture(raw={}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('BENCHMARK_FIXTURE_INVALID');
  if(raw.schema!==AUTONOMY_BENCHMARK_SCHEMA)throw new Error('BENCHMARK_SCHEMA_INVALID');
  const scenarioId=String(raw.scenarioId||'').trim();
  if(!scenarioId)throw new Error('BENCHMARK_SCENARIO_ID_REQUIRED');
  const tasksTotal=finiteNumber(raw.tasksTotal,'BENCHMARK_TASKS_TOTAL_INVALID',{min:1});
  const resourcesTotal=finiteNumber(raw.resourcesTotal,'BENCHMARK_RESOURCES_TOTAL_INVALID',{min:1});
  if(!Number.isInteger(tasksTotal))throw new Error('BENCHMARK_TASKS_TOTAL_INVALID');
  if(!Number.isInteger(resourcesTotal))throw new Error('BENCHMARK_RESOURCES_TOTAL_INVALID');
  if(!Array.isArray(raw.events)||raw.events.length<2)throw new Error('BENCHMARK_EVENTS_REQUIRED');
  const events=raw.events.map((event,index)=>{
    if(!event||typeof event!=='object'||Array.isArray(event))throw new Error(`BENCHMARK_EVENT_INVALID:${index}`);
    const type=String(event.type||'').trim();
    if(!type)throw new Error(`BENCHMARK_EVENT_TYPE_REQUIRED:${index}`);
    if(!EVENT_TYPES.has(type))throw new Error(`BENCHMARK_EVENT_TYPE_INVALID:${index}`);
    return {...event,type,__ms:eventTime(event,index),__index:index};
  });
  for(let i=1;i<events.length;i++)if(events[i].__ms<events[i-1].__ms)throw new Error(`BENCHMARK_EVENTS_NOT_SORTED:${i}`);
  return {schema:AUTONOMY_BENCHMARK_SCHEMA,scenarioId,tasksTotal,resourcesTotal,events};
}

export function computeAutonomyBenchmark(raw={}){
  const fixture=validateAutonomyBenchmarkFixture(raw);
  const {events,tasksTotal,resourcesTotal}=fixture;
  const firstMs=events[0].__ms;
  const lastMs=events.at(-1).__ms;
  let runnableWork=0,eligibleIdleResources=0,activeResources=0;
  let lastStateMs=firstMs;
  let backlogResourceMs=0,backlogWindowMs=0;
  let idleWindowStart=null;
  const idleGaps=[];
  const replanStart=new Map(),replanLatencies=[];
  const restartCommitted=new Set(),restartResumed=new Set();
  let duplicateDispatchCount=0,blockedParentFalseParkCount=0,ownerNudgeRequiredCount=0;
  let jobsCompleted=0,independentReviewViolations=0,unsafePlanRejections=0;
  let gateEscalations=0,exactGateEscalations=0;

  const integrateUntil=(ms)=>{
    const dt=Math.max(0,ms-lastStateMs);
    if(runnableWork>0){
      backlogWindowMs+=dt;
      backlogResourceMs+=dt*Math.min(resourcesTotal,Math.max(0,activeResources));
    }
    lastStateMs=ms;
  };
  const syncIdleWindow=(ms)=>{
    const idleEligible=runnableWork>0&&eligibleIdleResources>0;
    if(idleEligible&&idleWindowStart===null)idleWindowStart=ms;
    if(!idleEligible&&idleWindowStart!==null){
      idleGaps.push((ms-idleWindowStart)/1000);
      idleWindowStart=null;
    }
  };

  for(const event of events){
    integrateUntil(event.__ms);
    if(event.type==='state'){
      runnableWork=finiteNumber(event.runnableWork,'BENCHMARK_RUNNABLE_INVALID');
      eligibleIdleResources=finiteNumber(event.eligibleIdleResources,'BENCHMARK_IDLE_RESOURCE_INVALID');
      activeResources=finiteNumber(event.activeResources,'BENCHMARK_ACTIVE_RESOURCE_INVALID');
      if(!Number.isInteger(runnableWork)||!Number.isInteger(eligibleIdleResources)||!Number.isInteger(activeResources))throw new Error('BENCHMARK_STATE_COUNT_INVALID');
      if(activeResources>resourcesTotal||eligibleIdleResources>resourcesTotal)throw new Error('BENCHMARK_RESOURCE_COUNT_EXCEEDS_TOTAL');
      syncIdleWindow(event.__ms);
      continue;
    }
    if(event.type==='dispatch'){
      if(idleWindowStart!==null){
        idleGaps.push((event.__ms-idleWindowStart)/1000);
        idleWindowStart=null;
      }
      continue;
    }
    if(event.type==='job_completed'){jobsCompleted++;continue;}
    if(event.type==='owner_nudge'){ownerNudgeRequiredCount++;continue;}
    if(event.type==='duplicate_dispatch'){duplicateDispatchCount++;continue;}
    if(event.type==='false_parent_park'){blockedParentFalseParkCount++;continue;}
    if(event.type==='review_violation'){independentReviewViolations++;continue;}
    if(event.type==='unsafe_plan_rejected'){unsafePlanRejections++;continue;}
    if(event.type==='replan_requested'){
      const key=String(event.key||'').trim();
      if(!key)throw new Error('BENCHMARK_REPLAN_KEY_REQUIRED');
      replanStart.set(key,event.__ms);
      continue;
    }
    if(event.type==='replan_completed'){
      const key=String(event.key||'').trim();
      if(!replanStart.has(key))throw new Error(`BENCHMARK_REPLAN_START_MISSING:${key}`);
      replanLatencies.push((event.__ms-replanStart.get(key))/1000);
      replanStart.delete(key);
      continue;
    }
    if(event.type==='restart_committed'){
      const key=String(event.key||'').trim();
      if(!key)throw new Error('BENCHMARK_RESTART_KEY_REQUIRED');
      restartCommitted.add(key);
      continue;
    }
    if(event.type==='restart_resumed'){
      const key=String(event.key||'').trim();
      if(!restartCommitted.has(key))throw new Error(`BENCHMARK_RESTART_COMMIT_MISSING:${key}`);
      restartResumed.add(key);
      continue;
    }
    if(event.type==='gate_escalation'){
      gateEscalations++;
      if(event.realGate===true)exactGateEscalations++;
    }
  }
  integrateUntil(lastMs);
  if(idleWindowStart!==null)idleGaps.push((lastMs-idleWindowStart)/1000);

  const durationHours=Math.max(1/3600000,(lastMs-firstMs)/3600000);
  const restartResumeSuccess=restartCommitted.size?restartResumed.size/restartCommitted.size:1;
  const exactGateEscalationPrecision=gateEscalations?exactGateEscalations/gateEscalations:1;
  const resourceUtilizationWhenBacklogExists=backlogWindowMs?backlogResourceMs/(backlogWindowMs*resourcesTotal):0;

  return {
    schema:AUTONOMY_BENCHMARK_SCHEMA,
    scenarioId:fixture.scenarioId,
    tasksTotal,
    resourcesTotal,
    durationSeconds:round((lastMs-firstMs)/1000),
    metrics:{
      runnable_work_idle_gap_seconds:{samples:idleGaps.map(v=>round(v)),p95:round(percentileNearestRank(idleGaps,0.95)),max:round(idleGaps.length?Math.max(...idleGaps):0)},
      resource_utilization_when_backlog_exists:round(resourceUtilizationWhenBacklogExists),
      time_to_replan_seconds:{samples:replanLatencies.map(v=>round(v)),p95:round(percentileNearestRank(replanLatencies,0.95))},
      duplicate_dispatch_count:duplicateDispatchCount,
      blocked_parent_false_park_count:blockedParentFalseParkCount,
      restart_resume_success:round(restartResumeSuccess),
      owner_nudge_required_count:ownerNudgeRequiredCount,
      jobs_completed_per_hour:round(jobsCompleted/durationHours),
      independent_review_violations:independentReviewViolations,
      unsafe_plan_rejections:unsafePlanRejections,
      exact_gate_escalation_precision:round(exactGateEscalationPrecision),
    },
  };
}

export function evaluateAutonomyTargets(result={}){
  const metrics=result?.metrics||{};
  const p95=Number(metrics?.runnable_work_idle_gap_seconds?.p95);
  return {
    pass:Boolean(
      Number.isFinite(p95)&&p95<=30&&
      metrics.owner_nudge_required_count===0&&
      metrics.blocked_parent_false_park_count===0&&
      metrics.duplicate_dispatch_count===0&&
      metrics.restart_resume_success===1&&
      metrics.independent_review_violations===0
    ),
    checks:{
      idle_gap_p95_le_30:Number.isFinite(p95)&&p95<=30,
      owner_nudge_zero:metrics.owner_nudge_required_count===0,
      false_parent_park_zero:metrics.blocked_parent_false_park_count===0,
      duplicate_dispatch_zero:metrics.duplicate_dispatch_count===0,
      restart_resume_100pct:metrics.restart_resume_success===1,
      review_violation_zero:metrics.independent_review_violations===0,
    },
  };
}
