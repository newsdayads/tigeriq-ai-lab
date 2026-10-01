import { createHash } from 'node:crypto';

export const SELF_AUDIT_CONTRACTS = Object.freeze([
  { id:'AUTO_DISPATCH_CONTINUITY', severity:'HIGH', signal:'queue', description:'Eligible backlog with a healthy idle worker must not remain undispatched.' },
  { id:'REVIEW_INDEPENDENCE', severity:'HIGH', signal:'review', description:'Reviewer employee/resource must differ from implementation identities.' },
  { id:'TERMINAL_LEASE_RELEASE', severity:'HIGH', signal:'lease', description:'Terminal jobs must release lease and resource binding after a bounded settle window.' },
  { id:'DEGRADED_RESOURCE_ROUTING', severity:'HIGH', signal:'routing', description:'ERROR/RATE_LIMITED/OFFLINE/auth-blocked resources must not receive active work.' },
  { id:'RUNTIME_SOURCE_SHA', severity:'HIGH', signal:'runtime', description:'Known installed runtime SHA must match the expected source SHA.' },
  { id:'DEPENDENCY_TERMINAL_GATE', severity:'HIGH', signal:'dependency', description:'A dependency-gated objective must not be terminal completed before all gates pass.' },
  { id:'SERVICE_FUNCTIONAL_INTEGRITY', severity:'MEDIUM', signal:'functional', description:'A healthy service signal must not mask failed expected behavior checks.' },
  { id:'UPDATER_WATCHDOG_HEALTH', severity:'MEDIUM', signal:'watchdog', description:'Updater/watchdog health must remain true when those signals are available.' },
]);

const contractById=new Map(SELF_AUDIT_CONTRACTS.map(x=>[x.id,x]));
const upper=v=>String(v??'').trim().toUpperCase();
const arr=v=>Array.isArray(v)?v:[];

function anomaly(contractId,key,evidence){
  const contract=contractById.get(contractId);
  if(!contract)throw new Error('UNKNOWN_SELF_AUDIT_CONTRACT:'+contractId);
  const signature=createHash('sha256').update(contractId+'|'+String(key)).digest('hex').slice(0,20);
  return { signature, contractId, severity:contract.severity, key:String(key), evidence };
}

export function evaluateSelfAudit(snapshot={},{
  nowMs=Date.now(),
  minBacklogStableMs=15000,
  minTerminalSettleMs=5000,
}={}){
  const anomalies=[];
  const queue=snapshot.queue||{};
  const backlog=Number(queue.eligibleBacklogCount||0);
  const idle=Number(queue.eligibleIdleWorkers||0);
  const active=Number(queue.activeWorkCount||0);
  const backlogStableForMs=Number(queue.backlogStableForMs||0);
  if(backlog>0&&idle>0&&active===0&&backlogStableForMs>=minBacklogStableMs){
    anomalies.push(anomaly('AUTO_DISPATCH_CONTINUITY','queue',{
      eligibleBacklogCount:backlog,eligibleIdleWorkers:idle,activeWorkCount:active,backlogStableForMs
    }));
  }

  for(const review of arr(snapshot.reviews)){
    if(!['RUNNING','DONE','COMPLETED'].includes(upper(review.status)))continue;
    const implEmployees=new Set(arr(review.implementerEmployeeIds).map(upper).filter(Boolean));
    const implResources=new Set(arr(review.implementerResourceIds).map(String).filter(Boolean));
    const reviewerEmployee=upper(review.reviewerEmployeeId);
    const reviewerResource=String(review.reviewerResourceId||'');
    if((reviewerEmployee&&implEmployees.has(reviewerEmployee))||(reviewerResource&&implResources.has(reviewerResource))){
      anomalies.push(anomaly('REVIEW_INDEPENDENCE',review.jobId||review.reviewId||reviewerEmployee||reviewerResource,{
        jobId:review.jobId||null,reviewerEmployeeId:review.reviewerEmployeeId||null,reviewerResourceId:review.reviewerResourceId||null,
        implementerEmployeeIds:[...implEmployees],implementerResourceIds:[...implResources]
      }));
    }
  }

  for(const job of arr(snapshot.terminalJobs)){
    if(!['DONE','FAILED','COMPLETED','BLOCKED'].includes(upper(job.status)))continue;
    const completedAgeMs=Number(job.completedAgeMs||0);
    if(completedAgeMs<minTerminalSettleMs)continue;
    if(job.leaseUntil||job.resourceStillBound===true){
      anomalies.push(anomaly('TERMINAL_LEASE_RELEASE',job.id||job.jobId,{
        jobId:job.id||job.jobId||null,status:job.status||null,leaseUntil:job.leaseUntil||null,
        resourceStillBound:job.resourceStillBound===true,completedAgeMs
      }));
    }
  }

  for(const job of arr(snapshot.activeAssignments)){
    if(!['RUNNING','DISPATCHING'].includes(upper(job.status)))continue;
    const health=upper(job.healthState);
    const credential=upper(job.credentialState);
    const cooldownUntil=job.cooldownUntil?Date.parse(job.cooldownUntil):0;
    const degraded=['ERROR','RATE_LIMITED','OFFLINE','BLOCKED'].includes(health)
      ||['WAIT_KEY','BLOCKED','AUTH_BLOCKED'].includes(credential)
      ||(Number.isFinite(cooldownUntil)&&cooldownUntil>nowMs);
    if(degraded){
      anomalies.push(anomaly('DEGRADED_RESOURCE_ROUTING',job.jobId||job.id,{
        jobId:job.jobId||job.id||null,resourceId:job.resourceId||null,employeeId:job.employeeId||null,
        healthState:job.healthState||null,credentialState:job.credentialState||null,cooldownUntil:job.cooldownUntil||null
      }));
    }
  }

  const runtime=snapshot.runtime||{};
  const expectedSha=String(runtime.expectedSha||'').trim();
  const installedSha=String(runtime.installedSha||'').trim();
  if(expectedSha&&installedSha&&expectedSha!==installedSha){
    anomalies.push(anomaly('RUNTIME_SOURCE_SHA',expectedSha+'>'+installedSha,{expectedSha,installedSha}));
  }

  for(const dep of arr(snapshot.dependencies)){
    if(upper(dep.status)!=='COMPLETED')continue;
    if(dep.dependencyGateRequired===true&&dep.dependencyGatePass!==true){
      anomalies.push(anomaly('DEPENDENCY_TERMINAL_GATE',dep.objectiveId||dep.id,{
        objectiveId:dep.objectiveId||dep.id||null,status:dep.status||null,
        dependencyGateRequired:true,dependencyGatePass:dep.dependencyGatePass===true,
        dependencyGateReason:dep.dependencyGateReason||null
      }));
    }
  }

  const service=snapshot.service||{};
  const functionalFailures=arr(service.functionalFailures).map(String).filter(Boolean);
  if(service.healthy===true&&functionalFailures.length){
    anomalies.push(anomaly('SERVICE_FUNCTIONAL_INTEGRITY',functionalFailures.slice().sort().join('|'),{
      healthy:true,functionalFailures:functionalFailures.slice(0,20)
    }));
  }

  const watchdog=snapshot.watchdog||{};
  const updaterKnown=typeof watchdog.updaterHealthy==='boolean';
  const watchdogKnown=typeof watchdog.watchdogHealthy==='boolean';
  if((updaterKnown&&watchdog.updaterHealthy!==true)||(watchdogKnown&&watchdog.watchdogHealthy!==true)){
    anomalies.push(anomaly('UPDATER_WATCHDOG_HEALTH','runtime',{
      updaterHealthy:updaterKnown?watchdog.updaterHealthy:null,
      watchdogHealthy:watchdogKnown?watchdog.watchdogHealthy:null
    }));
  }

  return {
    ok:true,
    contractCount:SELF_AUDIT_CONTRACTS.length,
    evaluatedAt:new Date(nowMs).toISOString(),
    anomalies,
  };
}

export function anomalyMaterializationDecision(existing,anomalyRecord,{nowMs=Date.now(),cooldownMs=10*60*1000}={}){
  if(!existing)return {materialize:true,reason:'NEW_SIGNATURE'};
  if(upper(existing.status)==='RESOLVED')return {materialize:true,reason:'REOPENED_SIGNATURE'};
  const last=Date.parse(existing.last_materialized_at||existing.lastMaterializedAt||'');
  if(!Number.isFinite(last)||nowMs-last>=cooldownMs)return {materialize:true,reason:'COOLDOWN_ELAPSED'};
  return {materialize:false,reason:'DEDUP_COOLDOWN'};
}

export function syntheticSelfAuditCanary({nowMs=Date.now()}={}){
  const snapshot={
    queue:{eligibleBacklogCount:2,eligibleIdleWorkers:1,activeWorkCount:0,backlogStableForMs:60000},
    terminalJobs:[{id:'CANARY-JOB-LEASE',status:'done',leaseUntil:new Date(nowMs+60000).toISOString(),resourceStillBound:true,completedAgeMs:30000}],
    reviews:[],
    activeAssignments:[],
    runtime:{},
    dependencies:[],
    service:{healthy:true,functionalFailures:[]},
    watchdog:{},
  };
  const result=evaluateSelfAudit(snapshot,{nowMs,minBacklogStableMs:1000,minTerminalSettleMs:1000});
  const ids=new Set(result.anomalies.map(x=>x.contractId));
  return {
    ...result,
    canary:true,
    queueMutation:false,
    pass:ids.has('AUTO_DISPATCH_CONTINUITY')&&ids.has('TERMINAL_LEASE_RELEASE'),
  };
}
