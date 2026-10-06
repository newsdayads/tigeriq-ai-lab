export const SKILL_ROUTING_PREFLIGHT_SCHEMA = 'TIGERIQ_SKILL_ROUTING_PREFLIGHT_V1';

const unique = (values = []) => [...new Set((Array.isArray(values) ? values : [])
  .map(value => String(value || '').trim()).filter(Boolean))];

export function buildSkillRoutingPreflight({
  jobId = '',
  objectiveText = '',
  skillContext = {},
  requiredCapability = 'general',
  reviewerResourceIds = [],
  registryError = null,
} = {}) {
  const selectedSkillIds = unique((skillContext?.skills || []).map(skill => skill?.id));
  const skipped = (Array.isArray(skillContext?.skipped) ? skillContext.skipped : []).map(item => ({
    id: String(item?.id || 'UNKNOWN'),
    reason: String(item?.reason || 'UNKNOWN'),
  }));
  const capability = String(requiredCapability || 'general').trim().toLowerCase() || 'general';
  const registryFailure = registryError ? String(registryError).slice(0, 240) : null;
  const skillReason = selectedSkillIds.length
    ? 'ACTIVE_SKILL_MATCH'
    : registryFailure
      ? 'SKILL_REGISTRY_REJECTED_ALLOW_GENERIC'
      : skipped.length
        ? 'NO_LOADABLE_RELEVANT_ACTIVE_SKILL'
        : 'NO_RELEVANT_ACTIVE_SKILL';

  return {
    schema: SKILL_ROUTING_PREFLIGHT_SCHEMA,
    status: 'RESOURCE_PENDING',
    order: ['JOB', 'SKILL', 'CAPABILITY', 'RESOURCE'],
    jobId: String(jobId || ''),
    objectiveText: String(objectiveText || '').slice(0, 1200),
    selectedSkillIds,
    skillReason,
    skillPolicy: selectedSkillIds.length ? 'MATCHED_ACTIVE_SKILL' : 'ALLOW_GENERIC_WITH_REASON',
    requiredCapability: capability,
    reviewerIndependenceRequired: capability === 'review',
    reviewerResourceIds: unique(reviewerResourceIds),
    skipped,
    registryError: registryFailure,
    selectedResource: null,
    fallback: { policy: 'BOUNDED_FAILOVER_OR_PARK', used: false, attemptedCount: 0, failures: [] },
  };
}

export function finalizeSkillRoutingPreflight(preflight, {
  resource = null,
  routingDecision = null,
  failures = [],
  unavailableReason = 'RESOURCE_UNAVAILABLE',
} = {}) {
  if (!preflight || preflight.schema !== SKILL_ROUTING_PREFLIGHT_SCHEMA) {
    throw new Error('SKILL_ROUTING_PREFLIGHT_INVALID');
  }

  const failureEvidence = (Array.isArray(failures) ? failures : []).map(failure => ({
    employeeId: failure?.employeeId ? String(failure.employeeId) : null,
    resourceId: failure?.resourceId ? String(failure.resourceId) : null,
    provider: failure?.provider ? String(failure.provider) : null,
    kind: failure?.kind ? String(failure.kind) : null,
    message: failure?.message ? String(failure.message).slice(0, 240) : null,
  }));

  const resourceId = String(resource?.resourceId ?? resource?.resource_id ?? '').trim();
  const employeeId = String(resource?.id ?? resource?.employeeId ?? resource?.employee_id ?? '').trim();
  const provider = String(resource?.provider ?? '').trim();
  const selectedResource = resourceId ? { resourceId, employeeId: employeeId || null, provider: provider || null } : null;

  if (selectedResource && preflight.reviewerIndependenceRequired && preflight.reviewerResourceIds.includes(resourceId)) {
    throw new Error('SKILL_PREFLIGHT_REVIEWER_COLLISION');
  }

  const status = selectedResource ? 'ROUTED' : 'PARKED';
  const resourceReason = selectedResource ? 'SELECTED_HEALTHY_ZERO_COST_RESOURCE' : String(unavailableReason || 'RESOURCE_UNAVAILABLE');
  const chosen = routingDecision?.chosen || null;

  return {
    ...preflight,
    status,
    selectedResource,
    resourceReason,
    routingChoice: chosen ? {
      resourceId: chosen.resourceId ? String(chosen.resourceId) : null,
      employeeId: chosen.employeeId ? String(chosen.employeeId) : null,
      provider: chosen.provider ? String(chosen.provider) : null,
    } : null,
    fallback: {
      policy: 'BOUNDED_FAILOVER_OR_PARK',
      used: failureEvidence.length > 0,
      attemptedCount: failureEvidence.length,
      failures: failureEvidence,
    },
    chain: {
      jobId: preflight.jobId,
      selectedSkillIds: preflight.selectedSkillIds,
      skillReason: preflight.skillReason,
      requiredCapability: preflight.requiredCapability,
      resourceId: selectedResource?.resourceId || null,
      resourceReason,
    },
  };
}
