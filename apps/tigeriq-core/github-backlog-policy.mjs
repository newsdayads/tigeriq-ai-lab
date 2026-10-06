export const BACKLOG_PRIORITIES=Object.freeze(['P0','P1','P2','P3','P4','P5']);
export const PRIORITY_RANK=Object.freeze({P0:0,P1:1,P2:2,P3:3,P4:4,P5:5});

function escapeRe(value){return String(value).replace(/[.*+?^\${}()|[\]\\]/g,'\\$&');}

export function bodyValue(body,key){
  return String(body||'').match(new RegExp('^'+escapeRe(key)+'=([^\\r\\n]+)$','m'))?.[1]?.trim()||'';
}

export function exactBodyFlag(body,key,value='true'){
  return new RegExp('^'+escapeRe(key)+'='+escapeRe(value)+'$','m').test(String(body||''));
}

export function backlogPriority(body,fallback='P3'){
  const fallbackPriority=BACKLOG_PRIORITIES.includes(String(fallback||'').toUpperCase())?String(fallback).toUpperCase():'P3';
  return String(body||'').match(/^PRIORITY=(P[0-5])$/m)?.[1]||fallbackPriority;
}

export function isOwnerOnlyP0(body,title=''){
  return backlogPriority(body,'P3')==='P0'||/\[P0\]/i.test(String(title||''));
}

export function backlogAssignedExecutor(body){
  const text=String(body||'');
  for(const key of ['TARGET_EMPLOYEE','ASSIGNED_EXECUTOR','PRIMARY_EMPLOYEE']){
    const value=bodyValue(text,key).toUpperCase();
    if(/^NV\d{2}$/.test(value))return value;
  }
  return '';
}

export function backlogOwnerControlled(body){
  const text=String(body||'');
  return exactBodyFlag(text,'OWNER_CONTROLLED','true')
    || exactBodyFlag(text,'OWNER_HOLD','true')
    || exactBodyFlag(text,'OWNER_GATE','true')
    || exactBodyFlag(text,'OWNER_APPROVAL_REQUIRED','true');
}

export function effectiveBacklogPriority(body,fallback='P3'){
  const sourcePriority=backlogPriority(body,fallback);
  // P0 is an Owner-reserved authority class, never an employee execution priority.
  // Stale assignment/auto markers cannot downgrade or delegate it.
  const ownerControlled=sourcePriority==='P0'||backlogOwnerControlled(body);
  return {
    sourcePriority,
    priority:sourcePriority,
    ownerControlled,
    assignedExecutor:backlogAssignedExecutor(body),
    legacyP0Autonomous:false,
  };
}

export function backlogOwnerDirect(body){
  return exactBodyFlag(body,'OWNER_DIRECT','true');
}

export function backlogRole(body){
  return String(body||'').match(/^ROLE=(.+)$/m)?.[1]?.trim()||'';
}

function replaceBodyLine(body,key,value){
  const text=String(body||'');
  const re=new RegExp('^'+escapeRe(key)+'=[^\\r\\n]*$','m');
  return re.test(text)?text.replace(re,key+'='+value):(text.replace(/\s*$/,'')+'\n'+key+'='+value+'\n');
}

function removeBodyLine(body,key){
  const re=new RegExp('^'+escapeRe(key)+'=[^\\r\\n]*(?:\\r?\\n)?','m');
  return String(body||'').replace(re,'');
}

export function chatMutationOwnerPlan(body,title='',nowMs=Date.now()){
  const text=String(body||'');
  const owner=bodyValue(text,'MUTATION_OWNER').toUpperCase();
  if(owner!=='VY')return {owner,action:'none',reason:'NOT_VY_OWNER',leaseUntil:null};
  const leaseRaw=bodyValue(text,'CHAT_SESSION_LEASE_UNTIL');
  const leaseMs=Date.parse(leaseRaw);
  if(Number.isFinite(leaseMs)&&leaseMs>Number(nowMs))return {owner,action:'hold',reason:'ACTIVE_CHAT_LEASE',leaseUntil:leaseRaw};

  const appChrome=/\[APP-CHROME\]/i.test(String(title||''))
    || /^RESOURCE_SCOPE=APP_CHROME_/mi.test(text)
    || /^ALLOW_PATH_PREFIX=.*apps\/chrome-controller(?:\/|,|$)/mi.test(text)
    || /apps\/chrome-controller\//i.test(text);
  if(appChrome)return {owner,action:'preserve',reason:'APP_CHROME_OWNER_SCOPE',leaseUntil:leaseRaw||null};
  if(isOwnerOnlyP0(text,title)||backlogOwnerControlled(text))return {owner,action:'preserve',reason:'OWNER_GATE',leaseUntil:leaseRaw||null};
  if(isReviewOnlySpec(text))return {owner,action:'preserve',reason:'REVIEW_ONLY',leaseUntil:leaseRaw||null};

  const coding=exactBodyFlag(text,'AUTONOMOUS_CODE','true')||bodyValue(text,'EXECUTION_SURFACE').toUpperCase()==='CODING';
  const authorized=exactBodyFlag(text,'OWNER_MAINTENANCE_AUTHORIZED','true')
    || exactBodyFlag(text,'OWNER_DIRECT','true')
    || exactBodyFlag(text,'OWNER_SAFE_AUTO_APPROVAL','true');
  const safety=[
    ['ZERO_COST','true'],
    ['NO_DIRECT_MAIN','true'],
    ['NO_PRODUCTION_RELEASE','true'],
    ['NO_PAID_COST','true'],
    ['NO_CREDENTIAL_CHANGE','true'],
    ['NO_SECURITY_BOUNDARY_CHANGE','true'],
    ['NO_DESTRUCTIVE','true'],
  ].every(([key,value])=>exactBodyFlag(text,key,value));
  if(!coding)return {owner,action:'preserve',reason:'NON_CODING_SCOPE',leaseUntil:leaseRaw||null};
  if(!authorized)return {owner,action:'preserve',reason:'OWNER_AUTH_NOT_DURABLE',leaseUntil:leaseRaw||null};
  if(!safety)return {owner,action:'preserve',reason:'SAFETY_CONTRACT_INCOMPLETE',leaseUntil:leaseRaw||null};
  return {owner,action:'handoff',reason:Number.isFinite(leaseMs)?'CHAT_LEASE_EXPIRED':'CHAT_LEASE_MISSING',leaseUntil:leaseRaw||null};
}

export function applyChatMutationOwnerHandoff(body,title='',nowMs=Date.now()){
  const plan=chatMutationOwnerPlan(body,title,nowMs);
  if(plan.action!=='handoff')return {changed:false,body:String(body||''),plan};
  let next=String(body||'');
  next=replaceBodyLine(next,'MUTATION_OWNER','CORE_DYNAMIC_LEASE');
  next=replaceBodyLine(next,'TIGERIQ_EXECUTABLE','true');
  next=replaceBodyLine(next,'AUTO_QUEUE','INCLUDED');
  if(/^ACTIVE_EXECUTION=/m.test(next))next=replaceBodyLine(next,'ACTIVE_EXECUTION','true');
  next=removeBodyLine(next,'CHAT_SESSION_LEASE_UNTIL');
  next=replaceBodyLine(next,'VY_BACKGROUND_OWNER_FORBIDDEN','true');
  next=replaceBodyLine(next,'CHAT_OWNER_HANDOFF_AT',new Date(Number(nowMs)).toISOString());
  return {changed:next!==String(body||''),body:next,plan};
}

export function isReviewOnlySpec(body){
  const role=backlogRole(body).toUpperCase();
  return role==='REVIEW_ONLY'||exactBodyFlag(body,'REVIEW_ONLY','true');
}

export function isExecutionContractV1(body){
  const text=String(body||'');
  return /^EXECUTION_POLICY=#1456$/m.test(text)||
    /^EXECUTION_CONTRACT=(?:V1|VERSION_1)$/m.test(text)||
    /^ACTIVE_EXECUTION=/m.test(text)||
    /^CANONICAL_SPEC=/m.test(text);
}

export function executionContractV1Missing(body){
  const text=String(body||'');
  if(!isExecutionContractV1(text))return [];
  const missing=[];
  if(!exactBodyFlag(text,'ACTIVE_EXECUTION','true'))missing.push('ACTIVE_EXECUTION');
  if(!/^CANONICAL_SPEC=#\d+$/m.test(text))missing.push('CANONICAL_SPEC');
  if(!/^RESOURCE_SCOPE=\S.+$/m.test(text))missing.push('RESOURCE_SCOPE');
  if(!/^MUTATION_OWNER=\S.+$/m.test(text))missing.push('MUTATION_OWNER');
  for(const section of ['GOAL','CURRENT_STATE','IN_SCOPE','OUT_OF_SCOPE','NON_NEGOTIABLE_RULES','DEPENDENCIES','EXECUTION_ORDER','ACCEPTANCE','RECOVERY_RULE','STOP_CONDITIONS','EVIDENCE_FORMAT']){
    const heading='## '+section;
    if(!text.split(/\r?\n/).some(line=>line.trim()===heading))missing.push(section);
  }
  return missing;
}

export function isActiveExecutionSpec(body){
  if(isReviewOnlySpec(body))return false;
  if(!isExecutionContractV1(body))return true;
  return executionContractV1Missing(body).length===0;
}

function normalizedBacklogKeyPart(value=''){
  return String(value||'').trim().toLowerCase()
    .replace(/https?:\/\/github\.com\//g,'')
    .replace(/[^a-z0-9._#:/-]+/g,'-')
    .replace(/-+/g,'-')
    .replace(/^-|-$/g,'');
}

function firstBodyValue(body,keys=[]){
  for(const key of keys){
    const value=bodyValue(body,key);
    if(value)return value;
  }
  return '';
}

export function backlogCanonicalDedupeKey(spec={}){
  const body=String(spec?.body||'');
  const project=firstBodyValue(body,['PROJECT_ID','PROJECT']);
  const workstream=firstBodyValue(body,['WORKSTREAM_ID','WORK_PACKAGE_ID','WORKSTREAM','WORK_PACKAGE']);
  const objective=firstBodyValue(body,['OBJECTIVE_ID','RCA_FAMILY_KEY','RCA_SIGNATURE','API_DOCTOR_REPAIR_SIGNATURE','OBJECTIVE'])
    || String(spec?.title||'').replace(/^(?:\s*\[[^\]]+\])+\s*/g,'');
  const scope=String(spec?.resourceScope||bodyValue(body,'RESOURCE_SCOPE'));
  const target=firstBodyValue(body,['TARGET_ARTIFACT','TARGET_PR','TARGET_REPOSITORY','TARGET_BRANCH','TARGET_HEAD','TARGET_FILE']);
  return [project,workstream,objective,scope,target].map(normalizedBacklogKeyPart).join('|');
}

function backlogReadyAtMs(spec={}){
  const body=String(spec?.body||'');
  const raw=String(spec?.readyAt||bodyValue(body,'READY_AT')||spec?.createdAt||spec?.updatedAt||'');
  const ms=Date.parse(raw);
  return Number.isFinite(ms)?ms:Number.MAX_SAFE_INTEGER;
}

function backlogQueueClass(spec={}){
  const body=String(spec?.body||'');
  const state=bodyValue(body,'CURRENT_STATE').toUpperCase();
  const eligibility=bodyValue(body,'EXECUTION_ELIGIBILITY').toUpperCase();
  const ownerGate=['OWNER_CONTROLLED','OWNER_HOLD','OWNER_GATE','OWNER_APPROVAL_REQUIRED'].some((key)=>bodyValue(body,key).toLowerCase()==='true')
    ||eligibility==='HARD_GATE'||/OWNER_(?:GATE|REVIEW|ACCEPTANCE)|CHỜ.*OWNER|WAIT.*OWNER/.test(state);
  const terminal=bodyValue(body,'DONE').toLowerCase()==='true'||eligibility==='TERMINAL'||/DONE_VERIFIED|COMPLETED|SUPERSEDED/.test(state);
  if(terminal)return 50;
  if(ownerGate)return 40;
  if(eligibility.startsWith('PARKED')||/(?:WAIT|BLOCKED|CHỜ|BỊ_CHẶN)/.test(state))return 30;
  const review=String(spec?.capability||'').toLowerCase()==='review'
    || String(spec?.dispatchLane||'').toUpperCase()==='CORE_REVIEW'
    || bodyValue(body,'REVIEW_ONLY').toLowerCase()==='true'
    || /REVIEW|VERIFY|RÀ_SOÁT/.test(state);
  const leaseActive=(bodyValue(body,'ACTIVE_LEASE').toLowerCase()==='true'||bodyValue(body,'LEASE_STATE').toUpperCase()==='ACTIVE')
    &&(bodyValue(body,'HEARTBEAT_FRESH').toLowerCase()==='true'||bodyValue(body,'HEARTBEAT_STATE').toUpperCase()==='FRESH');
  if(leaseActive)return 0;
  if(review)return 20;
  const priority=String(spec?.priority||spec?.effectivePriority||spec?.sourcePriority||backlogPriority(body,'P3')).toUpperCase();
  return 10+(PRIORITY_RANK[priority]??PRIORITY_RANK.P3);
}

export function compareBacklogSpecs(a,b){
  const ca=backlogQueueClass(a);
  const cb=backlogQueueClass(b);
  if(ca!==cb)return ca-cb;
  const pa=PRIORITY_RANK[a?.priority||a?.effectivePriority||a?.sourcePriority]??PRIORITY_RANK.P3;
  const pb=PRIORITY_RANK[b?.priority||b?.effectivePriority||b?.sourcePriority]??PRIORITY_RANK.P3;
  if(pa!==pb)return pa-pb;
  const dependencyA=bodyValue(a?.body||'','DEPENDENCY_SATISFIED').toLowerCase()==='false'?1:0;
  const dependencyB=bodyValue(b?.body||'','DEPENDENCY_SATISFIED').toLowerCase()==='false'?1:0;
  if(dependencyA!==dependencyB)return dependencyA-dependencyB;
  const resourceA=bodyValue(a?.body||'','RESOURCE_MATCH').toLowerCase()==='false'?1:0;
  const resourceB=bodyValue(b?.body||'','RESOURCE_MATCH').toLowerCase()==='false'?1:0;
  if(resourceA!==resourceB)return resourceA-resourceB;
  const readyA=backlogReadyAtMs(a);
  const readyB=backlogReadyAtMs(b);
  if(readyA!==readyB)return readyA-readyB;
  return Number(a?.number||0)-Number(b?.number||0);
}

export function sortBacklogSpecs(specs){
  return (Array.isArray(specs)?specs:[]).filter(Boolean).slice().sort(compareBacklogSpecs);
}

export function detectIdleWithBacklog(activeCount,pendingQueueCount){
  return Number(activeCount||0)===0&&Number(pendingQueueCount||0)>0;
}

export function routingFault({eligibleBacklogCount=0,activeWorkCount=0,eligibleIdleWorkers=0}={}){
  const backlog=Math.max(0,Number(eligibleBacklogCount)||0);
  const active=Math.max(0,Number(activeWorkCount)||0);
  const idle=Math.max(0,Number(eligibleIdleWorkers)||0);
  const fault=backlog>0&&active===0&&idle>0;
  return {fault,eligibleBacklogCount:backlog,activeWorkCount:active,eligibleIdleWorkers:idle,code:fault?'ROUTING_FAULT':'OK'};
}
