export const API_DOCTOR_CAPABILITY='api_doctor';

const safeText=(value,max=240)=>String(value??'').trim().slice(0,max);

export function classifyApiDoctorFailure(input={}){
  const kind=safeText(input.kind||input.errorClass||'',80).toLowerCase();
  const message=safeText(input.message||input.error||'',500).toLowerCase();
  const status=Number(input.status||0);
  if(/credential|password|2fa|security|production|browser[-_ ]?auth|destructive|irreversible|paid[-_ ]?action|account[-_ ]?setting/.test(kind+' '+message))return 'hard_blocked';
  if(status===401||status===403||kind==='auth'||/\bhttp[_ -]?(401|403)\b/.test(message))return 'auth';
  if(status===402||/\bhttp[_ -]?402\b|payment required|free[- ]?tier.*exhaust|billing/.test(message))return 'external_blocked';
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
  cooldownUntil=null,
  validationAttempts=0,
  maxValidationAttempts=2,
  nowMs=Date.now(),
}={}){
  if(!existingHandoff)return {action:'proceed'};
  if(successAfterHandoff)return {action:'recovered',reason:'live_work_success_after_handoff'};
  const cooldownMs=cooldownUntil?Date.parse(String(cooldownUntil)):NaN;
  if(Number.isFinite(cooldownMs)&&cooldownMs>Number(nowMs))return {action:'wait_repair',reason:'repair_handoff_cooldown_active'};
  if(Number(validationAttempts)<Number(maxValidationAttempts))return {action:'validate_repair',reason:'post_repair_validation_due'};
  return {action:'wait_repair',reason:'post_repair_validation_budget_exhausted'};
}

export function apiDoctorRepairSignature({employeeId,provider,failureClass,message}={}){
  const normalized=safeText(message,180).toLowerCase().replace(/\d+/g,'#').replace(/\s+/g,' ');
  return [safeText(employeeId,32).toUpperCase(),safeText(provider,64).toLowerCase(),safeText(failureClass,64).toLowerCase(),normalized].join('|');
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
  if(a<0||b<a)throw new Error('API_DOCTOR_JSON_MISSING');
  let value;try{value=JSON.parse(raw.slice(a,b+1));}catch{throw new Error('API_DOCTOR_JSON_INVALID')}
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.summary!=='string')throw new Error('API_DOCTOR_SCHEMA_INVALID');
  for(const key of ['attention','sourceRepair'])if(value[key]!==undefined&&!Array.isArray(value[key]))throw new Error('API_DOCTOR_SCHEMA_INVALID');
  return {
    summary:safeText(value.summary,500),
    attention:[...new Set((value.attention||[]).map(x=>safeText(x,16)).filter(Boolean))].slice(0,10),
    sourceRepair:[...new Set((value.sourceRepair||[]).map(x=>safeText(x,16)).filter(Boolean))].slice(0,10),
  };
}
