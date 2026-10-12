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

// The live router forces GitHub coordination auto-work to LOCAL even if its
// persisted job metadata retains AUTO. Retries must use that same effective
// profile; otherwise transient NV10 unavailability becomes a terminal failure.
export function effectiveCoreJobRoutingProfile(job={}) {
  return job?.kind==='github_api_autowork'?'LOCAL':String(job?.routing_profile||'AUTO');
}
