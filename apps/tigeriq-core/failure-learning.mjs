import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export function computeFailureSignature(failure) {
  const parts = [
    failure?.errorCode || failure?.code || 'UNKNOWN_ERROR',
    failure?.taskKind || failure?.kind || 'unknown_task',
    failure?.profile || failure?.routingProfile || 'default'
  ];
  const raw = parts.join(':').toLowerCase();
  return createHash('sha256').update(raw).digest('hex');
}

export function generateFailureCandidate(failure, context = {}) {
  const signature = computeFailureSignature(failure);
  const errorCode = failure?.errorCode || failure?.code || 'UNKNOWN_ERROR';
  const taskKind = failure?.taskKind || failure?.kind || 'unknown_task';
  const timestamp = new Date().toISOString();
  
  return {
    id: `failure-candidate-${signature.slice(0, 12)}`,
    title: `Mitigate ${errorCode} in ${taskKind}`,
    state: 'CANDIDATE',
    version: '0.1.0',
    provenance_batch: context.batchId || 'owner-video-lessons-2026-09-18',
    source_log: context.sourceLog || 'learning-log/failure-learning.md',
    target: taskKind,
    error_signature: signature,
    triggers: `${errorCode} ${taskKind} failure error retry`,
    summary: `Automatically generated failure candidate for ${errorCode} occurring during ${taskKind}.`,
    created_at: timestamp,
    evidence: {
      error_code: errorCode,
      task_kind: taskKind,
      details: failure?.message || failure?.details || null
    }
  };
}

export function deduplicateCandidates(existingSkills = [], candidate) {
  const sig = candidate.error_signature;
  const duplicate = existingSkills.find(s => s.error_signature === sig || s.id === candidate.id);
  if (duplicate) {
    return {
      isDuplicate: true,
      existing: duplicate
    };
  }
  return {
    isDuplicate: false,
    candidate
  };
}

export async function registerFailureCandidate(registryPath, candidate) {
  const raw = await readFile(registryPath, 'utf8');
  const registry = parseYaml(raw);
  if (!Array.isArray(registry.skills)) {
    registry.skills = [];
  }
  const dedup = deduplicateCandidates(registry.skills, candidate);
  if (dedup.isDuplicate) {
    return { registered: false, reason: 'duplicate', existing: dedup.existing };
  }
  registry.skills.push(candidate);
  registry.updated = new Date().toISOString().slice(0, 10);
  await writeFile(registryPath, stringifyYaml(registry), 'utf8');
  return { registered: true, candidate };
}

export function governRegistryState(registry, skillId, newState) {
  const validStates = registry.states || ['CANDIDATE', 'VALIDATED', 'ACTIVE', 'DEPRECATED', 'REJECTED'];
  if (!validStates.includes(newState)) {
    throw new Error(`INVALID_REGISTRY_STATE:${newState}`);
  }
  const skill = (registry.skills || []).find(s => s.id === skillId);
  if (!skill) {
    return { success: false, reason: 'skill_not_found' };
  }
  skill.state = newState;
  return { success: true, skill };
}
