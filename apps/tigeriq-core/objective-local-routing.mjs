// Restrict explicitly local-only API objectives at the job router boundary.
// An instruction inside an AI prompt is NOT an enforceable provider restriction.
export function normalizeObjectiveRoutingProfile(value) {
  const profile=String(value??'AUTO').trim().toUpperCase()||'AUTO';
  if(profile!=='AUTO'&&profile!=='LOCAL')throw new Error('OBJECTIVE_ROUTING_PROFILE_INVALID');
  return profile;
}
export function objectiveJobRoutingProfile(metadata) {
  return metadata?.routingProfile==='LOCAL'?'LOCAL':'AUTO';
}

const RETRYABLE_LOCAL_RESOURCE_FAILURES=new Set(['timeout','outage','rate_limit','busy']);

// Fail-closed: only retry a previously configured, explicitly LOCAL objective
// after transient local-resource failures; never retry security/auth/paid failures
// or silently switch the job to a cloud provider.
export function mayWaitAfterLocalFailure({profile='AUTO',message='',failures=[],configuredLocalCount=0}={}) {
  return profile==='LOCAL'
    && message==='NO_AI_RESOURCE_AVAILABLE'
    && Number(configuredLocalCount)>0
    && Array.isArray(failures)
    && failures.length>0
    && failures.every(item=>RETRYABLE_LOCAL_RESOURCE_FAILURES.has(String(item?.kind||'')));
}

// Preserve explicit local-only objectives. Otherwise let the pre-provisioned
// FREE API roster assist GitHub coordination without adding any paid fallback.
// Execution, retry and queue visibility must call this same resolver.
export function effectiveCoreJobRoutingProfile(job={}) {
  return job?.kind==='github_api_autowork'
    ? (String(job?.routing_profile||'AUTO').toUpperCase()==='LOCAL'?'LOCAL':'AUTO')
    : String(job?.routing_profile||'AUTO');
}


// A direct Owner Work Order may pin a genuinely provisioned FREE worker even
// when it is outside the small default GitHub coordination pool. Never widen
// untargeted autowork, legacy intake, or another worker's allowed scope.
export function githubAutoworkEmployeeAllowlist(job={},baseline=[]){
  const defaults=[...new Set((Array.isArray(baseline)?baseline:[])
    .map(id=>String(id||'').trim().toUpperCase()).filter(Boolean))];
  const meta=job?.objective_metadata||{};
  const target=String(meta.targetWorker||'').trim().toUpperCase();
  return job?.kind==='github_api_autowork'
    && meta.ownerDirect===true
    && meta.admissionMode==='SAFE_P1_P5_POLICY'
    && target==='NV17'
    ? ['NV17']
    : defaults;
}

// The source-level target override cannot authorize a paid resource. Keep
// this invariant identical for actual claims and scheduler visibility.
export function githubAutoworkZeroCostResource(job={},resource={}){
  if(job?.kind!=='github_api_autowork')return true;
  return ['FREE','LOCAL'].includes(String(resource?.cost_tier||resource?.costTier||'').trim().toUpperCase());
}
