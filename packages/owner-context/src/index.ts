export type MemoryScope = 'operating' | 'decision' | 'goal' | 'rejection' | 'lesson';
export type DecisionState = 'ACTIVE' | 'REJECTED' | 'SUPERSEDED';
export type LearningState = 'CANDIDATE' | 'VERIFIED' | 'RETIRED';

export interface OperatingRule {
  id: string;
  text: string;
  tags: string[];
  priority: number;
  source: 'EXPLICIT_OWNER' | 'REPEATED_PATTERN' | 'VERIFIED_LESSON';
}

export interface DecisionRecord {
  id: string;
  topic: string;
  statement: string;
  tags: string[];
  state: DecisionState;
  createdAt: number;
  supersedes?: string | null;
  supersededBy?: string | null;
}

export interface GoalRecord {
  id: string;
  title: string;
  tags: string[];
  parentId?: string | null;
  state: 'ACTIVE' | 'DONE' | 'PAUSED';
  priority: number;
}

export interface RejectionRecord {
  id: string;
  fingerprint: string;
  reason: string;
  tags: string[];
  createdAt: number;
  expiresAt?: number | null;
}

export interface LearningCandidate {
  id: string;
  fingerprint: string;
  statement: string;
  tags: string[];
  observations: number;
  evidenceRefs: string[];
  explicitOwner: boolean;
  state: LearningState;
  createdAt: number;
  verifiedAt?: number | null;
}

export interface CompileInput {
  employeeId: string;
  taskTags: string[];
  maxItems?: number;
  now?: number;
}

export interface CompiledOwnerContext {
  schema: 'tigeriq-owner-context/v1';
  employeeId: string;
  operatingRules: OperatingRule[];
  decisions: DecisionRecord[];
  goals: GoalRecord[];
  rejections: RejectionRecord[];
  lessons: LearningCandidate[];
  itemCount: number;
}

const SENSITIVE_TAGS = new Set([
  'health', 'medical', 'finance-personal', 'family-private', 'credential', 'secret',
  'government-id', 'biometric', 'private-address', 'account-number', 'password',
]);

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((x) => x.trim().toLowerCase()).filter(Boolean))].sort();
}

function assertSafeTags(tags: string[]): void {
  const normalized = normalizeTags(tags);
  const blocked = normalized.find((tag) => SENSITIVE_TAGS.has(tag));
  if (blocked) throw new Error(`SENSITIVE_MEMORY_BLOCKED:${blocked}`);
}

function overlapScore(itemTags: string[], taskTags: string[]): number {
  const wanted = new Set(normalizeTags(taskTags));
  let score = 0;
  for (const tag of normalizeTags(itemTags)) if (wanted.has(tag)) score++;
  return score;
}

function stableByPriorityAndId<T extends { id: string }>(items: T[], score: (item: T) => number): T[] {
  return [...items].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
}

export class OwnerContextStore {
  readonly #rules = new Map<string, OperatingRule>();
  readonly #decisions = new Map<string, DecisionRecord>();
  readonly #goals = new Map<string, GoalRecord>();
  readonly #rejections = new Map<string, RejectionRecord>();
  readonly #learning = new Map<string, LearningCandidate>();

  addOperatingRule(rule: OperatingRule): void {
    assertSafeTags(rule.tags);
    if (!rule.id.trim() || !rule.text.trim()) throw new Error('OPERATING_RULE_INVALID');
    this.#rules.set(rule.id, structuredClone({ ...rule, tags: normalizeTags(rule.tags) }));
  }

  addDecision(record: DecisionRecord): void {
    assertSafeTags(record.tags);
    if (!record.id.trim() || !record.topic.trim() || !record.statement.trim()) throw new Error('DECISION_INVALID');
    if (record.supersedes) {
      const previous = this.#decisions.get(record.supersedes);
      if (!previous) throw new Error('DECISION_SUPERSEDE_TARGET_MISSING');
      if (previous.topic !== record.topic) throw new Error('DECISION_SUPERSEDE_TOPIC_MISMATCH');
      previous.state = 'SUPERSEDED';
      previous.supersededBy = record.id;
      this.#decisions.set(previous.id, structuredClone(previous));
    }
    this.#decisions.set(record.id, structuredClone({ ...record, tags: normalizeTags(record.tags) }));
  }

  addGoal(goal: GoalRecord): void {
    assertSafeTags(goal.tags);
    if (!goal.id.trim() || !goal.title.trim()) throw new Error('GOAL_INVALID');
    if (goal.parentId && !this.#goals.has(goal.parentId)) throw new Error('GOAL_PARENT_MISSING');
    this.#goals.set(goal.id, structuredClone({ ...goal, tags: normalizeTags(goal.tags) }));
  }

  addRejection(record: RejectionRecord): void {
    assertSafeTags(record.tags);
    if (!record.id.trim() || !record.fingerprint.trim()) throw new Error('REJECTION_INVALID');
    this.#rejections.set(record.fingerprint, structuredClone({ ...record, tags: normalizeTags(record.tags) }));
  }

  shouldSuppress(fingerprint: string, now = Date.now()): boolean {
    const found = this.#rejections.get(fingerprint);
    if (!found) return false;
    if (found.expiresAt && found.expiresAt <= now) return false;
    return true;
  }

  observeLearning(input: Omit<LearningCandidate, 'observations' | 'state' | 'createdAt' | 'verifiedAt'> & { createdAt?: number }): LearningCandidate {
    assertSafeTags(input.tags);
    const existing = this.#learning.get(input.fingerprint);
    if (existing) {
      existing.observations++;
      existing.explicitOwner ||= input.explicitOwner;
      existing.evidenceRefs = [...new Set([...existing.evidenceRefs, ...input.evidenceRefs])].sort();
      existing.tags = normalizeTags([...existing.tags, ...input.tags]);
      this.#learning.set(existing.fingerprint, structuredClone(existing));
      return structuredClone(existing);
    }
    const candidate: LearningCandidate = {
      id: input.id,
      fingerprint: input.fingerprint,
      statement: input.statement,
      tags: normalizeTags(input.tags),
      observations: 1,
      evidenceRefs: [...new Set(input.evidenceRefs)].sort(),
      explicitOwner: input.explicitOwner,
      state: 'CANDIDATE',
      createdAt: input.createdAt ?? Date.now(),
      verifiedAt: null,
    };
    this.#learning.set(candidate.fingerprint, candidate);
    return structuredClone(candidate);
  }

  promoteLearning(fingerprint: string, now = Date.now()): LearningCandidate {
    const candidate = this.#learning.get(fingerprint);
    if (!candidate) throw new Error('LEARNING_CANDIDATE_MISSING');
    const evidenceBacked = candidate.evidenceRefs.length > 0 && candidate.observations >= 2;
    if (!candidate.explicitOwner && !evidenceBacked) throw new Error('LEARNING_NOT_VERIFIED');
    candidate.state = 'VERIFIED';
    candidate.verifiedAt = now;
    this.#learning.set(fingerprint, structuredClone(candidate));
    return structuredClone(candidate);
  }

  retireLearning(fingerprint: string): void {
    const candidate = this.#learning.get(fingerprint);
    if (!candidate) return;
    candidate.state = 'RETIRED';
    this.#learning.set(fingerprint, structuredClone(candidate));
  }

  compile(input: CompileInput): CompiledOwnerContext {
    const maxItems = Math.max(1, Math.min(input.maxItems ?? 20, 100));
    const now = input.now ?? Date.now();
    const tags = normalizeTags(input.taskTags);
    const relevant = <T extends { id: string; tags: string[] }>(items: T[], extra: (item: T) => number = () => 0) =>
      stableByPriorityAndId(items.filter((item) => overlapScore(item.tags, tags) > 0 || item.tags.includes('global')),
        (item) => overlapScore(item.tags, tags) * 100 + extra(item));

    const rules = relevant([...this.#rules.values()], (x) => x.priority).map(structuredClone);
    const decisions = relevant([...this.#decisions.values()].filter((x) => x.state === 'ACTIVE')).map(structuredClone);
    const goals = relevant([...this.#goals.values()].filter((x) => x.state === 'ACTIVE'), (x) => x.priority).map(structuredClone);
    const rejections = relevant([...this.#rejections.values()].filter((x) => !x.expiresAt || x.expiresAt > now)).map(structuredClone);
    const lessons = relevant([...this.#learning.values()].filter((x) => x.state === 'VERIFIED')).map(structuredClone);

    const buckets = [rules, decisions, goals, rejections, lessons] as Array<Array<{ id: string }>>;
    let remaining = maxItems;
    const sliced = buckets.map((bucket) => {
      const take = bucket.slice(0, remaining);
      remaining -= take.length;
      return take;
    });

    return {
      schema: 'tigeriq-owner-context/v1',
      employeeId: input.employeeId,
      operatingRules: sliced[0] as OperatingRule[],
      decisions: sliced[1] as DecisionRecord[],
      goals: sliced[2] as GoalRecord[],
      rejections: sliced[3] as RejectionRecord[],
      lessons: sliced[4] as LearningCandidate[],
      itemCount: maxItems - remaining,
    };
  }
}
