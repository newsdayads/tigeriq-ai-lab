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
    taskKind: input?.taskKind ? String(input.taskKind) : null,
    qualityVerified: input?.qualityVerified === true,
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

export function skillFailureLoopDecision({
  outcome = 'unknown',
  failureSignature = '',
  retryBudgetExhausted = false,
  retryCount = 0,
  maxRetries = 0,
  recurringCount = 0,
} = {}) {
  const normalized = normalizedOutcome({ outcome });
  const signature = String(failureSignature || '').trim();
  const terminalFailure = ['failed', 'blocked'].includes(normalized) && Boolean(signature);
  const retries = Math.max(0, Number(retryCount) || 0);
  const max = Math.max(0, Number(maxRetries) || 0);
  const recurring = Math.max(0, Number(recurringCount) || 0);
  const exhausted = retryBudgetExhausted === true || (max > 0 && retries >= max);
  const parked = terminalFailure && (exhausted || recurring >= 2);
  return {
    state: parked ? 'PARKED' : 'CLEAR',
    reason: parked ? (exhausted ? 'RETRY_BUDGET_EXHAUSTED' : 'RECURRING_FAILURE_SIGNATURE') : null,
    retryCount: retries,
    maxRetries: max,
    recurringCount: recurring,
    failureSignature: signature || null,
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
    verified: input?.verified === false ? false : true,
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

/** Advisory terminal evidence within a single objective and skill version; not causal proof of quality. */
export function scopedSkillLearningProfile(skill, records = [], { objectiveId, taskKind } = {}) {
  const unique = new Map(), conflicting = new Set();
  if (objectiveId && taskKind && skill?.id && skill?.version) {
    for (const row of Array.isArray(records) ? records : []) {
      if (!row || row.verified !== true || row.objectiveId !== objectiveId || row.taskKind !== taskKind ||
          row.skillId !== skill.id || row.version !== skill.version || !row.jobId ||
          row.evidenceRef !== `CORE_JOB:${row.jobId}` ||
          row.dedupeKey !== skillOutcomeDedupeKey({jobId:row.jobId,skillId:row.skillId,version:row.version}) ||
          !['completed','failed'].includes(row.outcome)) continue;
      if (row.outcome === 'completed' && row.qualityVerified !== true) continue;
      const previous = unique.get(row.dedupeKey);
      if (previous && previous.outcome !== row.outcome) conflicting.add(row.dedupeKey);
      else if (!previous) unique.set(row.dedupeKey,row);
    }
  }
  for (const key of conflicting) unique.delete(key);
  const samples = [...unique.values()];
  const success = samples.filter(row=>row.outcome==='completed').length;
  const failure = samples.length-success;
  return { skillId:skill?.id||null, version:skill?.version||null, sampleCount:samples.length,
    success, failure, confidence:samples.length>=5?'SUFFICIENT_SAMPLE':'INSUFFICIENT_SAMPLE',
    posterior:(success+2)/(samples.length+4), evidenceRefs:samples.map(row=>row.evidenceRef) };
}
