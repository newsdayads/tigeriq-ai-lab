export const ROUTING_PROFILES = Object.freeze(['AUTO','CODING','FAST','CHEAP','LOCAL','RESEARCH','REVIEW']);
export const ROUTING_PROFILE_LABELS = Object.freeze({
  AUTO:'Tự động',CODING:'Lập trình',FAST:'Nhanh',CHEAP:'Tiết kiệm',LOCAL:'Cục bộ',RESEARCH:'Nghiên cứu',REVIEW:'Kiểm tra độc lập',
});
const TERMINAL_HEALTH = new Set(['OFFLINE','DISABLED']);
const FREE_TIERS = new Set(['FREE','LOCAL','ZERO']);

function resourcePart(value, fallback) {
  return String(value||fallback).trim().toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||fallback;
}
export function createResourceId(provider, modelOrAccount='unknown', account, runtime='core') {
  const p=resourcePart(provider,'unknown');
  if(account===undefined)return `res:${p}:${resourcePart(modelOrAccount,'default')}`;
  return `res:${p}:${resourcePart(modelOrAccount,'unknown')}:${resourcePart(account,'default')}:${resourcePart(runtime,'core')}`;
}

export function normalizeRoutingProfile(value='AUTO') {
  const profile=String(value||'AUTO').trim().toUpperCase();
  return ROUTING_PROFILES.includes(profile)?profile:'AUTO';
}

export function deriveRoutingProfile({requested,taskKind,capability}={}) {
  const normalizedRequested=normalizeRoutingProfile(requested||'AUTO');
  if(normalizedRequested!=='AUTO')return normalizedRequested;
  const kind=String(taskKind||'').toLowerCase();
  const cap=String(capability||'general').toLowerCase();
  if(cap==='coding'||kind==='coding')return 'CODING';
  if(cap==='review'||kind==='review')return 'REVIEW';
  if(kind==='research')return 'RESEARCH';
  return 'AUTO';
}

export function failurePolicy(kind='outage') {
  const k=String(kind||'outage').toLowerCase();
  if(k==='rate_limit')return {kind:k,retrySameResource:false,failover:true,cooldownMs:30*60*1000,stop:false};
  if(['auth','configuration','security','credential','paid','production','irreversible'].includes(k))return {kind:k,retrySameResource:false,failover:false,cooldownMs:6*60*60*1000,stop:true};
  if(k==='timeout')return {kind:k,retrySameResource:true,failover:true,cooldownMs:2*60*1000,stop:false};
  if(k==='invalid_response'||k==='model-output')return {kind:'invalid_response',retrySameResource:false,failover:true,cooldownMs:5*60*1000,stop:false};
  return {kind:'outage',retrySameResource:false,failover:true,cooldownMs:5*60*1000,stop:false};
}

function latestRecoveryMs(resetAt, cooldownUntil) {
  const values=[resetAt,cooldownUntil].filter(Boolean).map(value=>Date.parse(String(value))).filter(Number.isFinite);
  return values.length?Math.max(...values):NaN;
}

export function normalizeQuota(raw={}, nowMs=Date.now()) {
  const q=raw&&typeof raw==='object'?raw:{};
  const finite=(value)=>value===null||value===undefined||value===''?null:(Number.isFinite(Number(value))?Math.max(0,Number(value)):null);
  const requestLimit=finite(q.requestLimit??q.requestsLimit);
  const requestRemaining=finite(q.requestRemaining??q.requestsRemaining);
  const tokenLimit=finite(q.tokenLimit??q.tokensLimit);
  const tokenRemaining=finite(q.tokenRemaining??q.tokensRemaining);
  let remainingRatio=finite(q.remainingRatio);
  if(remainingRatio!==null)remainingRatio=Math.min(1,remainingRatio);
  const ratios=[];
  if(requestLimit>0&&requestRemaining!==null)ratios.push(Math.max(0,Math.min(1,requestRemaining/requestLimit)));
  if(tokenLimit>0&&tokenRemaining!==null)ratios.push(Math.max(0,Math.min(1,tokenRemaining/tokenLimit)));
  if(remainingRatio===null&&ratios.length)remainingRatio=Math.min(...ratios);
  const known=q.known===true||remainingRatio!==null||[requestLimit,requestRemaining,tokenLimit,tokenRemaining].some(v=>v!==null);
  const resetAt=q.resetAt?String(q.resetAt):null;
  const cooldownUntil=q.cooldownUntil?String(q.cooldownUntil):null;
  const recoveryMs=latestRecoveryMs(resetAt,cooldownUntil);
  let usable=q.usable!==false;
  if(remainingRatio!==null&&remainingRatio<=0){
    usable=Number.isFinite(recoveryMs)&&recoveryMs<=nowMs;
  } else if(!usable&&Number.isFinite(recoveryMs)&&recoveryMs<=nowMs) {
    usable=true;
  }
  const last429At=q.last429At?String(q.last429At):null;
  const sourceConfidence=['high','medium','low'].includes(String(q.sourceConfidence))?String(q.sourceConfidence):'low';
  return {known,usable,remainingRatio,requestLimit,requestRemaining,tokenLimit,tokenRemaining,resetAt,cooldownUntil,last429At,sourceConfidence};
}

export function rateLimitFailureState(rawQuota={}, policyCooldownMs=30*60*1000, nowMs=Date.now()) {
  const quota=normalizeQuota(rawQuota,nowMs);
  const resetMs=quota.resetAt?Date.parse(quota.resetAt):NaN;
  const fallbackMs=nowMs+Math.max(0,Number(policyCooldownMs)||0);
  const recoveryMs=Number.isFinite(resetMs)&&resetMs>nowMs?resetMs:fallbackMs;
  const cooldownUntil=new Date(recoveryMs).toISOString();
  return {cooldownUntil,quotaPatch:{usable:false,cooldownUntil,last429At:new Date(nowMs).toISOString(),sourceConfidence:quota.sourceConfidence==='high'?'high':'medium'}};
}

export function quotaUsable(raw={}, nowMs=Date.now()) {
  const q=normalizeQuota(raw,nowMs);
  if(q.usable)return true;
  const recoveryMs=latestRecoveryMs(q.resetAt,q.cooldownUntil);
  return Number.isFinite(recoveryMs)&&recoveryMs<=nowMs;
}

function successRate(resource) {
  const ok=Math.max(0,Number(resource.success_count??resource.successCount??0));
  const fail=Math.max(0,Number(resource.failure_count??resource.failureCount??0));
  const total=ok+fail;
  return total?ok/total:0.5;
}
function taskStats(resource, taskKind) {
  const stats=resource.taskStats&&typeof resource.taskStats==='object'?resource.taskStats:{};
  return stats[String(taskKind||'general')]||stats.general||{};
}
function capabilities(resource) {
  return Array.isArray(resource.capabilities)?resource.capabilities.map(x=>String(x).toLowerCase()):['general'];
}
function isFree(resource) {
  if(resource.zeroOutOfPocket===true)return true;
  const tier=String(resource.cost_tier??resource.costTier??'FREE').toUpperCase();
  return FREE_TIERS.has(tier);
}
function isLocal(resource) {
  return resource.local===true||String(resource.provider||'').toLowerCase()==='ollama'||String(resource.cost_tier??resource.costTier??'').toUpperCase()==='LOCAL';
}
function cooldownActive(resource, nowMs) {
  if(!resource.cooldown_until&&!resource.cooldownUntil)return false;
  const until=Date.parse(String(resource.cooldown_until??resource.cooldownUntil));
  return Number.isFinite(until)&&until>nowMs;
}

export function scoreResource(resource,{profile='AUTO',capability='general',taskKind='general',reviewerResourceId=null,reviewerResourceIds=[],nowMs=Date.now()}={}) {
  const normalizedProfile=normalizeRoutingProfile(profile);
  const resourceId=String(resource.resource_id??resource.resourceId??createResourceId(resource.provider,resource.model,resource.account_binding??resource.accountBinding??'default',resource.runtime_binding??resource.runtimeBinding??'core'));
  const reasons=[];
  const reviewerExclusions=new Set([reviewerResourceId,...(Array.isArray(reviewerResourceIds)?reviewerResourceIds:[])].filter(Boolean).map(String));
  if(resource.enabled===false)return {eligible:false,resourceId,score:Infinity,reasons:['disabled']};
  if(TERMINAL_HEALTH.has(String(resource.health_state??resource.healthState??'').toUpperCase()))return {eligible:false,resourceId,score:Infinity,reasons:['health']};
  if(cooldownActive(resource,nowMs))return {eligible:false,resourceId,score:Infinity,reasons:['cooldown']};
  if(!quotaUsable(resource.quota_state??resource.quotaState??{},nowMs))return {eligible:false,resourceId,score:Infinity,reasons:['quota']};
  if(!isFree(resource))return {eligible:false,resourceId,score:Infinity,reasons:['paid_fallback_forbidden']};
  if(normalizedProfile==='LOCAL'&&!isLocal(resource))return {eligible:false,resourceId,score:Infinity,reasons:['profile_local']};
  if(normalizedProfile==='REVIEW'&&reviewerExclusions.has(resourceId))return {eligible:false,resourceId,score:Infinity,reasons:['reviewer_independence']};
  const caps=capabilities(resource);
  const wanted=String(capability||'general').toLowerCase();
  if(!caps.includes(wanted)&&!caps.includes('general'))return {eligible:false,resourceId,score:Infinity,reasons:['capability']};
  if(normalizedProfile==='CODING'&&!caps.includes('coding'))return {eligible:false,resourceId,score:Infinity,reasons:['coding_capability']};

  const baseRank=Math.max(0,Number(resource.rank??50));
  const latency=Math.max(0,Number(resource.last_latency_ms??resource.lastLatencyMs??0));
  const globalFailure=1-successRate(resource);
  const stats=taskStats(resource,taskKind);
  const taskOk=Math.max(0,Number(stats.success??0));
  const taskFail=Math.max(0,Number(stats.failure??0));
  const taskTotal=taskOk+taskFail;
  const taskFailure=taskTotal?taskFail/taskTotal:globalFailure;
  const taskLatency=Math.max(0,Number(stats.avgLatencyMs??stats.avg_latency_ms??latency));
  const retries=Math.max(0,Number(stats.retry??stats.retries??0));
  const failovers=Math.max(0,Number(stats.failover??stats.failovers??0));
  const quota=normalizeQuota(resource.quota_state??resource.quotaState??{},nowMs);
  let score=baseRank + globalFailure*25 + taskFailure*30 + retries*2 + failovers*3 + taskLatency/1500;
  if(normalizedProfile==='FAST')score+=taskLatency/350;
  if(normalizedProfile==='CHEAP')score+=isLocal(resource)?-12:0;
  if(normalizedProfile==='LOCAL')score-=20;
  if(normalizedProfile==='RESEARCH'&&caps.includes('reasoning'))score-=8;
  if(normalizedProfile==='REVIEW'&&caps.includes('review'))score-=10;
  if(quota.known&&quota.remainingRatio!==null){score+=(1-quota.remainingRatio)*20;reasons.push(`quota:${quota.remainingRatio.toFixed(2)}`);}
  reasons.push(`base:${baseRank}`,`latency:${taskLatency}`,`success:${successRate(resource).toFixed(2)}`,`taskFailure:${taskFailure.toFixed(2)}`);
  return {eligible:true,resourceId,score:Number(score.toFixed(3)),reasons};
}

export function validateRouterPreflight(workOrder = {}) {
  const reqSkill = workOrder.required_skill ?? workOrder.requiredSkill;
  const reqTools = workOrder.required_tools ?? workOrder.requiredTools;
  const reqStateRefs = workOrder.required_state_refs ?? workOrder.requiredStateRefs;
  if (!reqSkill && !reqTools && !reqStateRefs && !workOrder.strict_preflight) {
    return { valid: true, legacy: true, reasons: [] };
  }
  const reasons = [];
  if (!reqSkill) reasons.push('MISSING_REQUIRED_SKILL');
  if (!Array.isArray(reqTools) || reqTools.length === 0) reasons.push('MISSING_REQUIRED_TOOLS');
  if (!Array.isArray(reqStateRefs) || reqStateRefs.length === 0) reasons.push('MISSING_REQUIRED_STATE_REFS');
  return { valid: reasons.length === 0, legacy: false, reasons };
}

export function rankCandidates(resources,{profile='AUTO',capability='general',taskKind='general',reviewerResourceId=null,reviewerResourceIds=[],nowMs=Date.now()}={}) {
  const normalizedProfile=normalizeRoutingProfile(profile);
  const evaluated=(Array.isArray(resources)?resources:[]).map(resource=>({resource,...scoreResource(resource,{profile:normalizedProfile,capability,taskKind,reviewerResourceId,reviewerResourceIds,nowMs})}));
  const eligible=evaluated.filter(x=>x.eligible).sort((a,b)=>a.score-b.score||a.resourceId.localeCompare(b.resourceId));
  const chosen=eligible[0]||null;
  return {
    profile:normalizedProfile,
    taskKind:String(taskKind||'general'),
    capability:String(capability||'general'),
    candidates:evaluated.map(x=>({resourceId:x.resourceId,employeeId:x.resource.employee_id??x.resource.employeeId??null,provider:x.resource.provider??null,model:x.resource.model??null,eligible:x.eligible,score:Number.isFinite(x.score)?x.score:null,reasons:x.reasons})),
    chosen:chosen?{resourceId:chosen.resourceId,employeeId:chosen.resource.employee_id??chosen.resource.employeeId??null,provider:chosen.resource.provider??null,model:chosen.resource.model??null,score:chosen.score,reasons:chosen.reasons}:null,
  };
}
