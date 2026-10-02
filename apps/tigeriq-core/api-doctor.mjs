import {isRetryableManagerOutputError} from './manager-json.mjs';

export const API_DOCTOR_CAPABILITY='api_doctor';

const safeText=(value,max=240)=>String(value??'').trim().slice(0,max);

function apiDoctorDecisionError(code){
  const error=new Error(code);
  error.code=code;
  error.kind='invalid_response';
  return error;
}

export function apiDoctorLocalRefreshHealth({
  modelAvailable=true,
  currentHealth='READY',
  cooldownUntil=null,
  latestFunctionalEvent=null,
  nowMs=Date.now(),
}={}){
  if(!modelAvailable)return 'OFFLINE';
  const health=String(currentHealth||'READY').toUpperCase();
  const cooldownMs=cooldownUntil?Date.parse(String(cooldownUntil)):NaN;
  const cooling=Number.isFinite(cooldownMs)&&cooldownMs>Number(nowMs);
  if(cooling&&['ERROR','RATE_LIMITED'].includes(health))return health;
  return String(latestFunctionalEvent||'').toUpperCase()==='RESOURCE_SUCCESS'?'ONLINE':'READY';
}

export function apiDoctorResourceEligibleForCapability({
  employeeId='',
  healthState='READY',
  capability='general',
}={}){
  if(String(employeeId||'').trim().toUpperCase()!=='NV10')return true;
  if(String(capability||'').trim().toLowerCase()===API_DOCTOR_CAPABILITY)return true;
  return String(healthState||'').trim().toUpperCase()==='ONLINE';
}

export function apiDoctorHealthEvidenceEvents(events=[]){
  return (Array.isArray(events)?events:[]).filter(row=>{
    const taskKind=String(row?.task_kind||row?.data?.taskKind||'').trim().toLowerCase();
    const code=String(row?.data?.message||row?.data?.code||'').trim();
    return !(String(row?.type||'')==='RESOURCE_FAILURE'&&taskKind==='manager'&&isRetryableManagerOutputError({code}));
  });
}

export function classifyApiDoctorFailure(input={}){
  const kind=safeText(input.kind||input.errorClass||'',80).toLowerCase();
  const message=safeText(input.message||input.error||'',500).toLowerCase();
  const status=Number(input.status||0);
  if(/credential|password|2fa|security|production|browser[-_ ]?auth|destructive|irreversible|paid[-_ ]?action|account[-_ ]?setting/.test(kind+' '+message))return 'hard_blocked';
  if(kind==='external_blocked'||status===402||/token_quota_reached|\bhttp[_ -]?402\b|payment required|free[- ]?tier.*exhaust|billing/.test(message))return 'external_blocked';
  if(status===401||status===403||kind==='auth'||/\bhttp[_ -]?(401|403)\b/.test(message))return 'auth';
  if(status===429||kind==='rate_limit'||/\bhttp[_ -]?429\b|rate.?limit|quota/.test(message))return 'rate_limit';
  if(kind==='timeout'||/timeout|timed out|abort/.test(message))return 'timeout';
  if(kind==='invalid_response'||kind==='model-output'||/empty_response|schema|invalid_response|unexpected_response|json/.test(message))return 'source_contract';
  if(kind==='outage'||/\bhttp[_ -]?(500|502|503|504)\b|econnreset|fetch failed|provider_unavailable|outage/.test(message))return 'transient';
  if(kind==='configuration')return 'configuration';
  return kind||'unknown';
}

export function apiDoctorAction({
  healthState='READY',
  credentialState='READY',
  cooldownUntil=null,
  latestFailure=null,
  repeatedWorkFailures=0,
  nowMs=Date.now(),
}={}){
  const health=String(healthState||'READY').toUpperCase();
  const credential=String(credentialState||'READY').toUpperCase();
  const cls=classifyApiDoctorFailure(latestFailure||{});
  const cooldownMs=cooldownUntil?Date.parse(String(cooldownUntil)):NaN;
  const cooling=Number.isFinite(cooldownMs)&&cooldownMs>nowMs;

  if(['WAIT_KEY','BLOCKED'].includes(credential))return {action:'external_blocked',failureClass:'configuration',reason:'credential_or_account_gate'};
  if(cls==='hard_blocked')return {action:'external_blocked',failureClass:cls,reason:'security_or_owner_gate'};
  if(cls==='auth')return {action:'external_blocked',failureClass:cls,reason:'auth_gate'};
  if(cls==='external_blocked')return {action:'external_blocked',failureClass:cls,reason:'http_402_or_free_tier'};
  if((health==='RATE_LIMITED'||cls==='rate_limit')&&cooling)return {action:'wait',failureClass:'rate_limit',reason:'cooldown_active'};
  if(health==='RATE_LIMITED'||cls==='rate_limit')return {action:'probe',failureClass:'rate_limit',reason:'cooldown_due'};
  if(cls==='source_contract'&&Number(repeatedWorkFailures)>=2)return {action:'probe_then_handoff',failureClass:cls,reason:'repeated_work_contract_failure'};
  if(['source_contract','timeout','transient'].includes(cls))return {action:'probe',failureClass:cls,reason:'bounded_reprobe'};
  if(['ERROR','OFFLINE','READY'].includes(health)&&!cooling)return {action:'probe',failureClass:cls,reason:'health_recheck'};
  return {action:'idle',failureClass:cls,reason:'healthy_or_no_action'};
}

export function apiDoctorExistingHandoffAction({
  existingHandoff=false,
  successAfterHandoff=false,
  healthState='READY',
  cooldownUntil=null,
  validationAttempts=0,
  maxValidationAttempts=2,
  nowMs=Date.now(),
}={}){
  if(!existingHandoff)return {action:'proceed'};
  const canonicalHealthy=['READY','ONLINE'].includes(String(healthState||'').toUpperCase());
  if(successAfterHandoff&&canonicalHealthy)return {action:'recovered',reason:'live_work_success_after_handoff'};
  const cooldownMs=cooldownUntil?Date.parse(String(cooldownUntil)):NaN;
  if(Number.isFinite(cooldownMs)&&cooldownMs>Number(nowMs))return {action:'wait_repair',reason:'repair_handoff_cooldown_active'};
  if(Number(validationAttempts)<Number(maxValidationAttempts))return {action:'validate_repair',reason:'post_repair_validation_due'};
  return {action:'wait_repair',reason:'post_repair_validation_budget_exhausted'};
}

export function apiDoctorCurrentFailure(events=[]){
  for(const row of Array.isArray(events)?events:[]){
    const type=String(row?.type||'');
    if(type==='RESOURCE_SUCCESS'||type==='RESOURCE_PROBE_OK')return null;
    if(type==='RESOURCE_FAILURE'||type==='RESOURCE_PROBE_FAIL')return row;
  }
  return null;
}

export function apiDoctorHandoffMatchesFailureClass(handoff,currentFailureClass){
  if(!handoff)return false;
  const handoffClass=safeText(handoff?.data?.failureClass||'',64).toLowerCase();
  const current=safeText(currentFailureClass||'',64).toLowerCase();
  if(!handoffClass||!current)return false;
  return handoffClass===current;
}

export function apiDoctorRepairLifecycleRelevant({
  hasHandoff=false,repairIssueNumber=0,handoffFailureClass='',currentFailureClass='',currentAction='',
}={}){
  if(!hasHandoff)return false;
  const current=String(currentFailureClass||'').trim().toLowerCase();
  const action=String(currentAction||'').trim().toLowerCase();
  if(current==='rate_limit'&&['wait','probe'].includes(action))return false;
  if(Number(repairIssueNumber||0)>0)return true;
  return String(handoffFailureClass||'').trim().toLowerCase()==='source_contract'&&['source_contract','unknown',''].includes(current);
}

export function apiDoctorRepairSignature({employeeId,provider,failureClass,message}={}){
  const normalized=safeText(message,180).toLowerCase().replace(/\d+/g,'#').replace(/\s+/g,' ');
  return [safeText(employeeId,32).toUpperCase(),safeText(provider,64).toLowerCase(),safeText(failureClass,64).toLowerCase(),normalized].join('|');
}

export function apiDoctorRepairWorkOrderGate({issueNumber=0,state='unknown',stateReason=null}={}){
  const number=Number(issueNumber||0);
  if(!Number.isInteger(number)||number<=0)return {action:'legacy',reason:'legacy_repair_handoff'};
  const normalizedState=String(state||'unknown').toLowerCase();
  const normalizedReason=String(stateReason||'').toLowerCase();
  if(normalizedState==='open')return {action:'wait_repair',reason:'canonical_repair_work_order_open'};
  if(normalizedState==='closed'&&normalizedReason==='completed')return {action:'validate_repair',reason:'canonical_repair_work_order_completed'};
  if(normalizedState==='closed')return {action:'wait_repair',reason:'canonical_repair_work_order_not_completed'};
  return {action:'wait_repair',reason:'canonical_repair_work_order_state_unknown'};
}

export function apiDoctorRepairDeploymentGate({
  issueNumber=0,state='unknown',stateReason=null,issueClosedAt=null,
  runtimeCurrentSha='',runtimeInstalledSha='',runtimeUpdatedAt=null,
  updaterResult='',updaterCandidateSha='',
}={}){
  const issueGate=apiDoctorRepairWorkOrderGate({issueNumber,state,stateReason});
  if(issueGate.action!=='validate_repair')return issueGate;
  const closedMs=Date.parse(String(issueClosedAt||''));
  const runtimeMs=Date.parse(String(runtimeUpdatedAt||''));
  if(!Number.isFinite(closedMs)||!Number.isFinite(runtimeMs)||runtimeMs<closedMs){
    return {action:'wait_repair',reason:'canonical_repair_runtime_not_applied_after_completion'};
  }
  const current=String(runtimeCurrentSha||'').trim().toLowerCase();
  const installed=String(runtimeInstalledSha||'').trim().toLowerCase();
  if(!/^[0-9a-f]{40}$/.test(current)||!/^[0-9a-f]{40}$/.test(installed)||current!==installed){
    return {action:'wait_repair',reason:'canonical_repair_runtime_source_not_aligned'};
  }
  const result=String(updaterResult||'').trim().toUpperCase();
  if(!['UPDATED','NO_CHANGE'].includes(result)){
    return {action:'wait_repair',reason:'canonical_repair_runtime_updater_not_terminal'};
  }
  const candidate=String(updaterCandidateSha||'').trim().toLowerCase();
  if(candidate&&candidate!==installed){
    return {action:'wait_repair',reason:'canonical_repair_runtime_candidate_not_installed'};
  }
  return {action:'validate_repair',reason:'canonical_repair_runtime_applied'};
}

export function buildApiDoctorRepairWorkOrder({
  employeeId='',
  provider='',
  resourceId='',
  failureClass='source_contract',
  message='',
  signature='',
}={}){
  const employee=safeText(employeeId,32).toUpperCase();
  const providerName=safeText(provider,64).toLowerCase();
  const cls=safeText(failureClass,64).toLowerCase();
  if(!/^NV\d{2}$/.test(employee)||!providerName||cls!=='source_contract')throw new Error('API_DOCTOR_REPAIR_WORK_ORDER_INVALID');
  const repairSignature=signature||apiDoctorRepairSignature({employeeId:employee,provider:providerName,failureClass:cls,message});
  const scopeToken=`${employee}_${providerName}`.toUpperCase().replace(/[^A-Z0-9_]+/g,'_').replace(/^_+|_+$/g,'').slice(0,64);
  const resourceScope=`API_DOCTOR_SOURCE_REPAIR_${scopeToken}`;
  const evidence=safeText(message||cls,300);
  const title=`[P1][API DOCTOR][SOURCE REPAIR][${employee}] ${providerName} source-contract repair`;
  const body=[
    'TIGERIQ_JOB_V1',
    'SOURCE=API_DOCTOR',
    'PARENT=#2890 - Sửa vòng repair provider đúng policy + không bị control-plane deny',
    'RELATED=#1255 - API Doctor — tự audit/phục hồi NV API khác + handoff source repair',
    'EXECUTION_POLICY=#1456',
    'ACTIVE_EXECUTION=true',
    'CANONICAL_SPEC=#1255',
    'CURRENT_STATE=READY_AUTO_EXECUTION',
    'TIGERIQ_EXECUTABLE=true',
    'AUTO_QUEUE=INCLUDED',
    'OWNER_POLICY=AUTO',
    'PRIORITY=P1',
    'CAPABILITY=coding',
    'EXECUTION_SURFACE=CODING',
    'AUTONOMOUS_CODE=true',
    `RESOURCE_SCOPE=${resourceScope}`,
    'MUTATION_OWNER=CORE_DYNAMIC_LEASE',
    'OWNER_PROXY=NV02',
    'AUTO_CONTROL_REPAIR=true',
    'INDEPENDENT_REPAIR_REQUIRED=true',
    'ZERO_COST=true',
    'NO_DIRECT_MAIN=true',
    'NO_PC01_SHELL=true',
    'NO_PRODUCTION_RELEASE=true',
    'NO_PAID_COST=true',
    'NO_CREDENTIAL_CHANGE=true',
    'NO_SECURITY_BOUNDARY_CHANGE=true',
    'NO_DESTRUCTIVE=true',
    'NO_BROWSER_AUTH=true',
    'APP_CHROME_MUTATION=FORBIDDEN',
    'ONE_RESOURCE_SCOPE_ONE_WRITER=true',
    'ALLOW_PATH_PREFIX=apps/tigeriq-core/core.mjs,tests/api-doctor-supervisor.test.mjs',
    `API_DOCTOR_REPAIR_SIGNATURE=${repairSignature}`,
    `API_DOCTOR_RESOURCE_ID=${safeText(resourceId,220)}`,
    `API_DOCTOR_EMPLOYEE_ID=${employee}`,
    `API_DOCTOR_PROVIDER=${providerName}`,
    `API_DOCTOR_FAILURE_CLASS=${cls}`,
    '',
    '## GOAL',
    `Repair only the ${employee}/${providerName} provider source-contract defect evidenced by: ${evidence}`,
    '',
    '## CURRENT_STATE',
    'READY_AUTO_EXECUTION',
    '',
    '## IN_SCOPE',
    '- Provider adapter/response handling in apps/tigeriq-core/core.mjs.',
    '- Focused regression coverage in tests/api-doctor-supervisor.test.mjs.',
    '',
    '## OUT_OF_SCOPE',
    '- Credentials, billing, account/security settings, Production, App Chrome, destructive actions.',
    '- Any path outside ALLOW_PATH_PREFIX.',
    '',
    '## NON_NEGOTIABLE_RULES',
    '- Keep P1 lifecycle; never elevate repair to P0.',
    '- Branch -> PR -> exact-head checks -> independent review -> merge -> runtime/live verify.',
    '- RECOVERED requires a later normal Core work success; probe/validation alone is insufficient.',
    '',
    '## DEPENDENCIES',
    '- Existing API Doctor handoff evidence for this signature.',
    '',
    '## EXECUTION_ORDER',
    '1. Reproduce the source-contract failure with focused evidence.',
    '2. Implement the smallest safe source fix.',
    '3. Run focused regression and required exact-head gates.',
    '4. Obtain independent review and runtime/live validation.',
    '',
    '## ACCEPTANCE',
    '- Protected Core mutation is admitted only through delegated owner-proxy repair intent.',
    '- Real normal Core work succeeds after the repair before RECOVERED is emitted.',
    '- No duplicate repair Work Order exists for the same open signature.',
    '',
    '## RECOVERY_RULE',
    'Fail closed; keep the provider quarantined/waiting when evidence is insufficient.',
    '',
    '## STOP_CONDITIONS',
    'DONE_WITH_EVIDENCE | REAL_BLOCKER | EXTERNAL_WAIT',
    '',
    '## EVIDENCE_FORMAT',
    'PR/head/checks/review/merge/runtime SHA + normal-work job/resource success evidence.',
    '',
    'DONE=false',
  ].join('\n');
  return {title,body,priority:'P1',resourceScope,signature:repairSignature};
}

export function buildApiDoctorPrompt(items=[]){
  const compact=(Array.isArray(items)?items:[]).slice(0,10).map(x=>({
    employeeId:safeText(x.employeeId,16),
    provider:safeText(x.provider,32),
    health:safeText(x.health,24),
    failureClass:safeText(x.failureClass,32),
    action:safeText(x.action,32),
  }));
  return [
    'You are NV10, TigerIQ API Doctor.',
    'Analyze ONLY the supplied provider health summary. Do not suggest paid upgrades, credential changes, account/security changes, Production changes, or destructive actions.',
    'Return ONLY one compact JSON object: {"summary":"short","attention":["NVxx"],"sourceRepair":["NVxx"]}.',
    'Keep the response under 1200 characters.',
    JSON.stringify(compact),
  ].join('\n');
}

export function parseApiDoctorDecision(text){
  const raw=String(text||'').trim().replace(/^\`\`\`(?:json)?\s*/i,'').replace(/\s*\`\`\`$/,'');
  const a=raw.indexOf('{'),b=raw.lastIndexOf('}');
  if(a<0||b<a)throw apiDoctorDecisionError('API_DOCTOR_JSON_MISSING');
  let value;try{value=JSON.parse(raw.slice(a,b+1));}catch{throw apiDoctorDecisionError('API_DOCTOR_JSON_INVALID')}
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.summary!=='string')throw apiDoctorDecisionError('API_DOCTOR_SCHEMA_INVALID');
  for(const key of ['attention','sourceRepair'])if(value[key]!==undefined&&!Array.isArray(value[key]))throw apiDoctorDecisionError('API_DOCTOR_SCHEMA_INVALID');
  return {
    summary:safeText(value.summary,500),
    attention:[...new Set((value.attention||[]).map(x=>safeText(x,16)).filter(Boolean))].slice(0,10),
    sourceRepair:[...new Set((value.sourceRepair||[]).map(x=>safeText(x,16)).filter(Boolean))].slice(0,10),
  };
}
