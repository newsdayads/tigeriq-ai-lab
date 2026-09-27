import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSkillRegistry } from './skill-loader.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_REGISTRY = join(REPO_ROOT, 'docs', 'skills', 'registry.yaml');
const DEFAULT_QUEUE = join(REPO_ROOT, 'docs', 'skills', 'promotion-queue.json');
const SKILL_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_MAX_ATTEMPTS = 3;

export const PROMOTION_STATES = Object.freeze([
  'VALIDATED_WAITING_CANARY',
  'CANARY_READY',
  'CANARY_RUNNING',
  'PROMOTION_READY',
  'ACTIVE',
  'VALIDATED_BLOCKED_EVIDENCE',
]);
const PROMOTION_STATE_SET = new Set(PROMOTION_STATES);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertSkillId(value) {
  const id = String(value || '').trim();
  if (!SKILL_ID_RE.test(id)) throw new Error('SKILL_PROMOTION_INVALID_SKILL_ID');
  return id;
}

function normalizeAttempts(value, fallback = 0) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function normalizeMaxAttempts(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : DEFAULT_MAX_ATTEMPTS;
}

function normalizeEvidence(value) {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === 'object').map(clone) : [];
}

export function parsePromotionQueue(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : clone(raw);
  } catch {
    throw new Error('SKILL_PROMOTION_QUEUE_MALFORMED:JSON');
  }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error('SKILL_PROMOTION_QUEUE_MALFORMED:SHAPE');
  }
  const seen = new Set();
  const entries = parsed.entries.map((row) => {
    const skillId = assertSkillId(row?.skillId);
    if (seen.has(skillId)) throw new Error(`SKILL_PROMOTION_QUEUE_DUPLICATE:${skillId}`);
    seen.add(skillId);
    const status = String(row?.status || '').trim();
    if (!PROMOTION_STATE_SET.has(status)) throw new Error(`SKILL_PROMOTION_QUEUE_INVALID_STATUS:${skillId}`);
    const attempts = normalizeAttempts(row?.attempts);
    const maxAttempts = normalizeMaxAttempts(row?.maxAttempts);
    if (attempts > maxAttempts) throw new Error(`SKILL_PROMOTION_QUEUE_INVALID_ATTEMPTS:${skillId}`);
    const nextCondition = String(row?.nextCondition || '').trim();
    if (status !== 'ACTIVE' && !nextCondition) throw new Error(`SKILL_PROMOTION_QUEUE_MISSING_NEXT_CONDITION:${skillId}`);
    const blocker = String(row?.blocker || '').trim();
    if (status === 'VALIDATED_BLOCKED_EVIDENCE' && !blocker) {
      throw new Error(`SKILL_PROMOTION_QUEUE_MISSING_BLOCKER:${skillId}`);
    }
    return {
      skillId,
      status,
      attempts,
      maxAttempts,
      blocker: blocker || null,
      nextCondition: nextCondition || null,
      nextEligibleAt: row?.nextEligibleAt || null,
      fixtureRef: row?.fixtureRef || null,
      provenanceRef: row?.provenanceRef || null,
      promotionEligible: row?.promotionEligible === true,
      evidence: normalizeEvidence(row?.evidence),
    };
  });
  return { version: 1, updated: parsed.updated || null, entries };
}

export function reconcilePromotionQueue(registry, queue, options = {}) {
  const parsedQueue = parsePromotionQueue(queue);
  const maxAttempts = normalizeMaxAttempts(options.maxAttempts);
  const byId = new Map(parsedQueue.entries.map((row) => [row.skillId, row]));
  const skills = Array.isArray(registry?.skills) ? registry.skills : [];

  for (const skill of skills) {
    const id = assertSkillId(skill?.id);
    if (skill.state === 'VALIDATED' && !byId.has(id)) {
      byId.set(id, {
        skillId: id,
        status: 'VALIDATED_WAITING_CANARY',
        attempts: 0,
        maxAttempts,
        blocker: 'NO_CANARY_FIXTURE',
        nextCondition: 'fixture_or_real_task_with_measurable_use_measure_evidence',
        nextEligibleAt: null,
        fixtureRef: null,
        provenanceRef: skill.source_log || skill.provenance_batch || null,
        promotionEligible: false,
        evidence: [],
      });
    }
    if (skill.state === 'ACTIVE' && byId.has(id)) {
      const current = byId.get(id);
      byId.set(id, {
        ...current,
        status: 'ACTIVE',
        blocker: null,
        nextCondition: null,
        nextEligibleAt: null,
        promotionEligible: false,
      });
    }
  }

  return {
    version: 1,
    updated: options.updated || parsedQueue.updated || null,
    entries: [...byId.values()].sort((a, b) => a.skillId.localeCompare(b.skillId)),
  };
}

function replaceEntry(queue, skillId, updater) {
  const parsed = parsePromotionQueue(queue);
  const id = assertSkillId(skillId);
  const index = parsed.entries.findIndex((row) => row.skillId === id);
  if (index < 0) throw new Error(`SKILL_PROMOTION_QUEUE_NOT_FOUND:${id}`);
  const next = clone(parsed);
  next.entries[index] = updater(clone(next.entries[index]));
  return parsePromotionQueue(next);
}

export function markCanaryReady(queue, skillId, { fixtureRef, provenanceRef } = {}) {
  const fixture = String(fixtureRef || '').trim();
  const provenance = String(provenanceRef || '').trim();
  if (!fixture || !provenance) throw new Error('SKILL_PROMOTION_CANARY_REQUIRES_FIXTURE_AND_PROVENANCE');
  return replaceEntry(queue, skillId, (entry) => ({
    ...entry,
    status: 'CANARY_READY',
    blocker: null,
    nextCondition: 'run_bounded_canary',
    nextEligibleAt: null,
    fixtureRef: fixture,
    provenanceRef: provenance,
    promotionEligible: false,
  }));
}

export function startCanary(queue, skillId) {
  return replaceEntry(queue, skillId, (entry) => {
    if (entry.status !== 'CANARY_READY') throw new Error(`SKILL_PROMOTION_CANARY_NOT_READY:${entry.skillId}`);
    if (entry.attempts >= entry.maxAttempts) throw new Error(`SKILL_PROMOTION_RETRY_LIMIT:${entry.skillId}`);
    return {
      ...entry,
      status: 'CANARY_RUNNING',
      attempts: entry.attempts + 1,
      nextCondition: 'record_canary_result',
      nextEligibleAt: null,
    };
  });
}

export function recordCanaryResult(queue, skillId, result = {}) {
  return replaceEntry(queue, skillId, (entry) => {
    if (entry.status !== 'CANARY_RUNNING') throw new Error(`SKILL_PROMOTION_CANARY_NOT_RUNNING:${entry.skillId}`);
    const outcome = String(result.outcome || '').toUpperCase();
    const at = String(result.at || new Date().toISOString());
    if (outcome === 'PASS') {
      const useCount = Number(result.useCount || 0);
      const measureRef = String(result.measureRef || '').trim();
      const evidenceRef = String(result.evidenceRef || '').trim();
      if (!Number.isFinite(useCount) || useCount < 1 || !measureRef || !evidenceRef) {
        throw new Error(`SKILL_PROMOTION_PASS_REQUIRES_USE_MEASURE_EVIDENCE:${entry.skillId}`);
      }
      return {
        ...entry,
        status: 'PROMOTION_READY',
        blocker: null,
        nextCondition: 'promote_registry_via_branch_pr_review',
        nextEligibleAt: null,
        promotionEligible: true,
        evidence: [...entry.evidence, {
          type: 'USE_MEASURE',
          outcome: 'PASS',
          at,
          useCount,
          measureRef,
          evidenceRef,
        }],
      };
    }

    if (!['FAIL', 'BLOCKED'].includes(outcome)) throw new Error('SKILL_PROMOTION_RESULT_INVALID');
    const blocker = String(result.blocker || '').trim();
    const nextCondition = String(result.nextCondition || '').trim();
    if (!blocker || !nextCondition) throw new Error(`SKILL_PROMOTION_BLOCKED_REQUIRES_NEXT_CONDITION:${entry.skillId}`);
    const retryAfterSeconds = Math.max(60, Math.min(86400, Number(result.retryAfterSeconds || 300)));
    const retryAllowed = entry.attempts < entry.maxAttempts;
    const nextEligibleAt = retryAllowed ? new Date(Date.parse(at) + retryAfterSeconds * 1000).toISOString() : null;
    return {
      ...entry,
      status: 'VALIDATED_BLOCKED_EVIDENCE',
      blocker,
      nextCondition,
      nextEligibleAt,
      promotionEligible: false,
      evidence: [...entry.evidence, {
        type: 'CANARY_RESULT',
        outcome,
        at,
        blocker,
        nextCondition,
        retryAllowed,
      }],
    };
  });
}

export function summarizePromotionQueue(registry, queue) {
  const parsed = parsePromotionQueue(queue);
  const skills = Array.isArray(registry?.skills) ? registry.skills : [];
  const active = skills.filter((skill) => skill.state === 'ACTIVE').length;
  const waitingStates = new Set(['VALIDATED_WAITING_CANARY', 'CANARY_READY', 'CANARY_RUNNING']);
  return {
    active,
    validatedWaiting: parsed.entries.filter((entry) => waitingStates.has(entry.status)).length,
    validatedBlocked: parsed.entries.filter((entry) => entry.status === 'VALIDATED_BLOCKED_EVIDENCE').length,
    canaryReady: parsed.entries.filter((entry) => entry.status === 'CANARY_READY').length,
    canaryRunning: parsed.entries.filter((entry) => entry.status === 'CANARY_RUNNING').length,
    promotionEligible: parsed.entries.filter((entry) => entry.status === 'PROMOTION_READY' && entry.promotionEligible).length,
    tracked: parsed.entries.length,
  };
}

export function serializePromotionQueue(queue) {
  const parsed = parsePromotionQueue(queue);
  return JSON.stringify(parsed, null, 2) + '\n';
}

export function loadSkillPromotionState(options = {}) {
  const registryPath = resolve(options.registryPath || DEFAULT_REGISTRY);
  const queuePath = resolve(options.queuePath || DEFAULT_QUEUE);
  const registry = loadSkillRegistry(registryPath);
  const rawQueue = readFileSync(queuePath, 'utf8');
  const queue = reconcilePromotionQueue(registry, parsePromotionQueue(rawQueue), options);
  return {
    registry,
    queue,
    summary: summarizePromotionQueue(registry, queue),
  };
}
