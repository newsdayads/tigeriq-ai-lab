const eventsMap = new Map();
let legacySequence = 0;

const OUTCOMES = new Set(['completed', 'failed', 'blocked', 'unknown']);

function normalizedOutcome(input = {}) {
  const direct = String(input?.outcome || '').trim().toLowerCase();
  if (OUTCOMES.has(direct)) return direct;
  if (input && typeof input === 'object' && 'success' in input) return input.success ? 'completed' : 'failed';
  return 'unknown';
}

function finiteDuration(value) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null;
}

export function skillOutcomeDedupeKey({ jobId = '', skillId = '', version = 'unknown' } = {}) {
  const job = String(jobId || '').trim();
  const skill = String(skillId || '').trim();
  const ver = String(version || 'unknown').trim() || 'unknown';
  if (!job || !skill) throw new Error('SKILL_EFFECTIVENESS_IDENTITY_REQUIRED');
  return `${job}::${skill}::${ver}`;
}

export function buildSkillOutcomeObservation(id, input = {}) {
  if (!id) throw new Error('Skill ID is required');
  const jobId = String(input?.jobId || '').trim();
  const version = String(input?.version || 'unknown').trim() || 'unknown';
  if (!jobId) throw new Error('Skill effectiveness jobId is required');
  const outcome = normalizedOutcome(input);
  const verified = input?.verified === true;
  const evidenceRef = String(input?.evidenceRef || '').trim() || null;
  const failureSignature = ['failed', 'blocked'].includes(outcome)
    ? String(input?.failureSignature || '').trim().slice(0, 240) || null
    : null;
  return {
    schema: 'TIGERIQ_SKILL_EFFECTIVENESS_V2',
    dedupeKey: skillOutcomeDedupeKey({ jobId, skillId: id, version }),
    skillId: String(id),
    version,
    jobId,
    objectiveId: input?.objectiveId ? String(input.objectiveId) : null,
    outcome,
    verified,
    resourceId: input?.resourceId ? String(input.resourceId) : null,
    employeeId: input?.employeeId ? String(input.employeeId) : null,
    provider: input?.provider ? String(input.provider) : null,
    durationMs: finiteDuration(input?.durationMs),
    evidenceRef,
    failureSignature,
  };
}

export function summarizeSkillEffectiveness(id, records = []) {
  if (!id) throw new Error('Skill ID is required');
  const unique = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || record.skillId !== id || record.verified !== true || !record.dedupeKey) continue;
    if (!unique.has(record.dedupeKey)) unique.set(record.dedupeKey, record);
  }
  const verifiedRecords = [...unique.values()];
  const usage = verifiedRecords.length;
  const completed = verifiedRecords.filter(record => record.outcome === 'completed').length;
  const failed = verifiedRecords.filter(record => record.outcome === 'failed').length;
  const blocked = verifiedRecords.filter(record => record.outcome === 'blocked').length;
  const durations = verifiedRecords.map(record => record.durationMs).filter(Number.isFinite);
  const signatures = new Map();
  for (const record of verifiedRecords) {
    if (!record.failureSignature) continue;
    signatures.set(record.failureSignature, (signatures.get(record.failureSignature) || 0) + 1);
  }
  const recurringFailureSignatures = [...signatures.entries()]
    .filter(([, count]) => count >= 2)
    .map(([signature, count]) => ({ signature, count }))
    .sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature));
  const evidenceRefs = [...new Set(verifiedRecords.map(record => record.evidenceRef).filter(Boolean))];
  const versions = [...new Set(verifiedRecords.map(record => record.version).filter(Boolean))];
  const state = usage ? 'OBSERVED' : 'UNKNOWN';
  return {
    id,
    state,
    total: usage,
    usage,
    completed,
    failed,
    blocked,
    failedBlocked: failed + blocked,
    successRate: usage ? completed / usage : 0,
    observedSuccessRatio: usage ? completed / usage : null,
    duration: {
      observedCount: durations.length,
      averageMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
    },
    recurringFailureSignatures,
    failureLoopState: recurringFailureSignatures.length ? 'PARKED' : 'CLEAR',
    evidenceRefs,
    versions,
  };
}

export function recordSkillOutcome(id, input = {}) {
  const observation = buildSkillOutcomeObservation(id, input);
  const records = eventsMap.get(id) || new Map();
  const existing = records.get(observation.dedupeKey);
  if (!existing || (existing.verified !== true && observation.verified === true)) {
    records.set(observation.dedupeKey, observation);
    eventsMap.set(id, records);
  }
  return {
    id,
    duplicate: Boolean(existing?.verified === true),
    counted: observation.verified === true && !existing?.verified,
    observation,
    metrics: summarizeSkillEffectiveness(id, [...records.values()]),
  };
}

export function useSkill(id, input = {}) {
  if (!id) throw new Error('Skill ID is required');
  legacySequence += 1;
  const success = input && typeof input === 'object' && 'success' in input ? Boolean(input.success) : true;
  const result = recordSkillOutcome(id, {
    ...input,
    jobId: input?.jobId || `legacy-${legacySequence}`,
    version: input?.version || 'legacy',
    outcome: success ? 'completed' : 'failed',
    verified: input?.verified ?? true,
    evidenceRef: input?.evidenceRef || `legacy:${legacySequence}`,
  });
  return { id, success, dedupeKey: result.observation.dedupeKey };
}

export function measureEffectiveness(id) {
  if (!id) throw new Error('Skill ID is required');
  const records = eventsMap.get(id);
  return summarizeSkillEffectiveness(id, records ? [...records.values()] : []);
}

export function retireSkill(id) {
  if (!id) throw new Error('Skill ID is required');
  return eventsMap.delete(id);
}
