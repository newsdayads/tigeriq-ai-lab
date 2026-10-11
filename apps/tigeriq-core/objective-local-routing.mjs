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
