import { createHash } from 'node:crypto';

export type ImprovementCategory = 'performance' | 'reliability' | 'quality' | 'cost' | 'workflow' | 'safety';
export type CandidateStatus = 'CANDIDATE' | 'VERIFIED' | 'REJECTED' | 'SUPERSEDED';

export interface EvidenceRef {
  source: string;
  revision?: string;
  kind: 'test' | 'benchmark' | 'runtime' | 'review' | 'issue' | 'pr' | 'other';
}

export interface Observation {
  fingerprint: string;
  scope: string;
  category: ImprovementCategory;
  summary: string;
  impact: number; // 1..5
  frequency: number; // >=1
  confidence: number; // 0..1
  estimated_cost: number; // 0..5
  risk: number; // 0..5
  observed_at: number;
  evidence?: EvidenceRef[];
}

export interface ImprovementCandidate {
  id: string;
  fingerprint: string;
  scope: string;
  category: ImprovementCategory;
  summary: string;
  impact: number;
  frequency: number;
  confidence: number;
  estimated_cost: number;
  risk: number;
  score: number;
  observations: number;
  status: CandidateStatus;
  evidence: EvidenceRef[];
  created_at: number;
  updated_at: number;
  superseded_by?: string;
}

export interface GateApproval {
  implementer_id: string;
  reviewer_id: string;
  judge_id: string;
  reviewer_pass: boolean;
  judge_pass: boolean;
  evidence: EvidenceRef[];
}

export interface VerifiedLesson {
  id: string;
  fingerprint: string;
  scope: string;
  category: ImprovementCategory;
  statement: string;
  confidence: number;
  evidence: EvidenceRef[];
  verified_at: number;
  review_after?: number;
  status: 'ACTIVE' | 'SUPERSEDED' | 'RETIRED';
  superseded_by?: string;
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function improvementScore(input: Pick<Observation, 'impact' | 'frequency' | 'confidence' | 'estimated_cost' | 'risk'>): number {
  const impact = bounded(input.impact, 1, 5);
  const frequency = bounded(input.frequency, 1, 100);
  const confidence = bounded(input.confidence, 0, 1);
  const cost = bounded(input.estimated_cost, 0, 5);
  const risk = bounded(input.risk, 0, 5);
  return Number(((impact * Math.log2(frequency + 1) * confidence) / (1 + cost + risk)).toFixed(6));
}

function candidateId(fingerprint: string): string {
  return `imp_${createHash('sha256').update(fingerprint).digest('hex').slice(0, 16)}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class ImprovementEngine {
  readonly #candidates = new Map<string, ImprovementCandidate>();
  readonly #lessons = new Map<string, VerifiedLesson>();

  ingest(observation: Observation): ImprovementCandidate {
    if (!observation.fingerprint.trim() || !observation.scope.trim() || !observation.summary.trim()) {
      throw new Error('OBSERVATION_INVALID');
    }
    const id = candidateId(observation.fingerprint);
    const existing = this.#candidates.get(id);
    const evidence = dedupeEvidence([...(existing?.evidence ?? []), ...(observation.evidence ?? [])]);
    const merged: ImprovementCandidate = {
      id,
      fingerprint: observation.fingerprint,
      scope: observation.scope,
      category: observation.category,
      summary: observation.summary,
      impact: Math.max(existing?.impact ?? 1, bounded(observation.impact, 1, 5)),
      frequency: (existing?.frequency ?? 0) + Math.max(1, Math.floor(observation.frequency)),
      confidence: Math.max(existing?.confidence ?? 0, bounded(observation.confidence, 0, 1)),
      estimated_cost: bounded(observation.estimated_cost, 0, 5),
      risk: bounded(observation.risk, 0, 5),
      score: 0,
      observations: (existing?.observations ?? 0) + 1,
      status: existing?.status === 'VERIFIED' ? 'VERIFIED' : 'CANDIDATE',
      evidence,
      created_at: existing?.created_at ?? observation.observed_at,
      updated_at: observation.observed_at,
      superseded_by: existing?.superseded_by,
    };
    merged.score = improvementScore(merged);
    this.#candidates.set(id, merged);
    return clone(merged);
  }

  backlog(): ImprovementCandidate[] {
    return [...this.#candidates.values()]
      .filter((x) => x.status === 'CANDIDATE')
      .sort((a, b) => b.score - a.score || b.impact - a.impact || a.created_at - b.created_at)
      .map(clone);
  }

  verify(candidateIdValue: string, gate: GateApproval, verifiedAt: number, reviewAfter?: number): VerifiedLesson {
    const candidate = this.#candidates.get(candidateIdValue);
    if (!candidate) throw new Error('CANDIDATE_NOT_FOUND');
    if (candidate.status !== 'CANDIDATE' && candidate.status !== 'VERIFIED') throw new Error('CANDIDATE_NOT_VERIFIABLE');
    if (!gate.reviewer_pass || !gate.judge_pass) throw new Error('INDEPENDENT_GATE_FAILED');
    if (!gate.implementer_id || !gate.reviewer_id || !gate.judge_id) throw new Error('GATE_ACTOR_REQUIRED');
    if (gate.implementer_id === gate.reviewer_id || gate.implementer_id === gate.judge_id || gate.reviewer_id === gate.judge_id) {
      throw new Error('INDEPENDENT_GATE_REQUIRED');
    }
    const evidence = dedupeEvidence([...candidate.evidence, ...gate.evidence]);
    if (evidence.length === 0) throw new Error('EVIDENCE_REQUIRED');

    candidate.status = 'VERIFIED';
    candidate.updated_at = verifiedAt;
    candidate.evidence = evidence;
    this.#candidates.set(candidate.id, candidate);

    const lesson: VerifiedLesson = {
      id: `lesson_${candidate.id.slice(4)}`,
      fingerprint: candidate.fingerprint,
      scope: candidate.scope,
      category: candidate.category,
      statement: candidate.summary,
      confidence: candidate.confidence,
      evidence,
      verified_at: verifiedAt,
      review_after: reviewAfter,
      status: 'ACTIVE',
    };
    this.#lessons.set(lesson.id, lesson);
    return clone(lesson);
  }

  reject(candidateIdValue: string, at: number): ImprovementCandidate {
    const candidate = this.#requireCandidate(candidateIdValue);
    candidate.status = 'REJECTED';
    candidate.updated_at = at;
    return clone(candidate);
  }

  supersedeLesson(lessonId: string, replacementLessonId: string): VerifiedLesson {
    const lesson = this.#lessons.get(lessonId);
    const replacement = this.#lessons.get(replacementLessonId);
    if (!lesson || !replacement) throw new Error('LESSON_NOT_FOUND');
    if (lesson.id === replacement.id) throw new Error('SELF_SUPERSEDE_INVALID');
    lesson.status = 'SUPERSEDED';
    lesson.superseded_by = replacement.id;
    return clone(lesson);
  }

  retireStale(now: number): VerifiedLesson[] {
    const retired: VerifiedLesson[] = [];
    for (const lesson of this.#lessons.values()) {
      if (lesson.status === 'ACTIVE' && lesson.review_after !== undefined && now >= lesson.review_after) {
        lesson.status = 'RETIRED';
        retired.push(clone(lesson));
      }
    }
    return retired;
  }

  activeLessons(): VerifiedLesson[] {
    return [...this.#lessons.values()].filter((x) => x.status === 'ACTIVE').map(clone);
  }

  #requireCandidate(id: string): ImprovementCandidate {
    const candidate = this.#candidates.get(id);
    if (!candidate) throw new Error('CANDIDATE_NOT_FOUND');
    return candidate;
  }
}

function dedupeEvidence(items: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.source}@${item.revision ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface PerformanceSample {
  startup_to_action_ms?: number;
  queue_wait_ms?: number;
  source_fetches?: number;
  bytes_loaded?: number;
  cache_hit_ratio?: number;
  deep_reads?: number;
  tool_latency_ms?: number;
  journal_latency_ms?: number;
  write_amplification?: number;
}

export interface PerformanceBudget {
  max_startup_to_action_ms?: number;
  max_queue_wait_ms?: number;
  max_source_fetches?: number;
  max_bytes_loaded?: number;
  min_cache_hit_ratio?: number;
  max_deep_reads?: number;
  max_tool_latency_ms?: number;
  max_journal_latency_ms?: number;
  max_write_amplification?: number;
}

export function assessPerformance(sample: PerformanceSample, budget: PerformanceBudget): { pass: boolean; violations: string[] } {
  const violations: string[] = [];
  maxCheck('startup_to_action_ms', sample.startup_to_action_ms, budget.max_startup_to_action_ms, violations);
  maxCheck('queue_wait_ms', sample.queue_wait_ms, budget.max_queue_wait_ms, violations);
  maxCheck('source_fetches', sample.source_fetches, budget.max_source_fetches, violations);
  maxCheck('bytes_loaded', sample.bytes_loaded, budget.max_bytes_loaded, violations);
  minCheck('cache_hit_ratio', sample.cache_hit_ratio, budget.min_cache_hit_ratio, violations);
  maxCheck('deep_reads', sample.deep_reads, budget.max_deep_reads, violations);
  maxCheck('tool_latency_ms', sample.tool_latency_ms, budget.max_tool_latency_ms, violations);
  maxCheck('journal_latency_ms', sample.journal_latency_ms, budget.max_journal_latency_ms, violations);
  maxCheck('write_amplification', sample.write_amplification, budget.max_write_amplification, violations);
  return { pass: violations.length === 0, violations };
}

function maxCheck(name: string, value: number | undefined, limit: number | undefined, violations: string[]): void {
  if (limit === undefined) return;
  if (!Number.isFinite(limit)) { violations.push(`${name}:BUDGET_INVALID`); return; }
  if (value === undefined || !Number.isFinite(value)) { violations.push(`${name}:MISSING`); return; }
  if (value > limit) violations.push(`${name}:${value}>${limit}`);
}
function minCheck(name: string, value: number | undefined, limit: number | undefined, violations: string[]): void {
  if (limit === undefined) return;
  if (!Number.isFinite(limit)) { violations.push(`${name}:BUDGET_INVALID`); return; }
  if (value === undefined || !Number.isFinite(value)) { violations.push(`${name}:MISSING`); return; }
  if (value < limit) violations.push(`${name}:${value}<${limit}`);
}

export type ResourceClass = 'github' | 'browser' | 'api' | 'pc01' | 'cpu' | 'io';
export interface ResourceNeed { class: ResourceClass; key?: string; units?: number; }
export interface ScheduleRequest {
  task_id: string;
  employee_id: string;
  priority: number;
  foreground?: boolean;
  resources: ResourceNeed[];
  submitted_at: number;
}
export interface ScheduleDecision { task_id: string; state: 'RUNNING' | 'QUEUED'; }

export class GlobalScheduler {
  readonly #capacity: Record<ResourceClass, number>;
  readonly #used: Record<ResourceClass, number> = { github: 0, browser: 0, api: 0, pc01: 0, cpu: 0, io: 0 };
  readonly #locks = new Map<string, string>();
  readonly #running = new Map<string, ScheduleRequest>();
  readonly #queue: ScheduleRequest[] = [];

  constructor(capacity: Partial<Record<ResourceClass, number>> = {}) {
    this.#capacity = {
      github: Math.max(1, capacity.github ?? 4),
      browser: Math.max(1, capacity.browser ?? 2),
      api: Math.max(1, capacity.api ?? 4),
      pc01: Math.max(1, capacity.pc01 ?? 1),
      cpu: Math.max(1, capacity.cpu ?? 2),
      io: Math.max(1, capacity.io ?? 2),
    };
  }

  submit(request: ScheduleRequest): ScheduleDecision {
    if (!request.task_id.trim() || !request.employee_id.trim()) throw new Error('SCHEDULE_REQUEST_INVALID');
    if (this.#running.has(request.task_id) || this.#queue.some((x) => x.task_id === request.task_id)) throw new Error('TASK_DUPLICATE');
    if (this.#canRun(request)) {
      this.#start(request);
      return { task_id: request.task_id, state: 'RUNNING' };
    }
    this.#queue.push(clone(request));
    this.#sortQueue();
    return { task_id: request.task_id, state: 'QUEUED' };
  }

  release(taskId: string): string[] {
    const request = this.#running.get(taskId);
    if (!request) return [];
    this.#running.delete(taskId);
    for (const need of request.resources) {
      const units = Math.max(1, need.units ?? 1);
      this.#used[need.class] = Math.max(0, this.#used[need.class] - units);
      if (need.key) this.#locks.delete(`${need.class}:${need.key}`);
    }
    const started: string[] = [];
    for (let i = 0; i < this.#queue.length;) {
      const next = this.#queue[i];
      if (!this.#canRun(next)) { i++; continue; }
      this.#queue.splice(i, 1);
      this.#start(next);
      started.push(next.task_id);
    }
    return started;
  }

  running(): string[] { return [...this.#running.keys()]; }
  queued(): string[] { return this.#queue.map((x) => x.task_id); }

  #canRun(request: ScheduleRequest): boolean {
    return request.resources.every((need) => {
      const units = Math.max(1, need.units ?? 1);
      if (this.#used[need.class] + units > this.#capacity[need.class]) return false;
      if (need.key && this.#locks.has(`${need.class}:${need.key}`)) return false;
      return true;
    });
  }

  #start(request: ScheduleRequest): void {
    this.#running.set(request.task_id, clone(request));
    for (const need of request.resources) {
      const units = Math.max(1, need.units ?? 1);
      this.#used[need.class] += units;
      if (need.key) this.#locks.set(`${need.class}:${need.key}`, request.task_id);
    }
  }

  #sortQueue(): void {
    this.#queue.sort((a, b) => Number(Boolean(b.foreground)) - Number(Boolean(a.foreground)) || b.priority - a.priority || a.submitted_at - b.submitted_at || a.task_id.localeCompare(b.task_id));
  }
}

export class StateWriteCoalescer {
  readonly #last = new Map<string, { digest: string; persisted_at: number }>();

  shouldPersist(key: string, payload: unknown, now: number, maxIntervalMs: number): { persist: boolean; reason: 'FIRST' | 'CHANGED' | 'MAX_INTERVAL' | 'UNCHANGED' } {
    const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const prior = this.#last.get(key);
    if (!prior) return { persist: true, reason: 'FIRST' };
    if (prior.digest !== digest) return { persist: true, reason: 'CHANGED' };
    if (now - prior.persisted_at >= Math.max(1, maxIntervalMs)) return { persist: true, reason: 'MAX_INTERVAL' };
    return { persist: false, reason: 'UNCHANGED' };
  }

  markPersisted(key: string, payload: unknown, at: number): void {
    const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    this.#last.set(key, { digest, persisted_at: at });
  }
}

export interface ImprovementCycleResult {
  backlog: ImprovementCandidate[];
  active_lessons: VerifiedLesson[];
  requires_human_or_gate_action: boolean;
}

export function runImprovementCycle(engine: ImprovementEngine, observations: Observation[], now: number): ImprovementCycleResult {
  observations.forEach((observation) => engine.ingest(observation));
  engine.retireStale(now);
  const backlog = engine.backlog();
  return {
    backlog,
    active_lessons: engine.activeLessons(),
    requires_human_or_gate_action: backlog.length > 0,
  };
}
