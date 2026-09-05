export type WorkSafetyLevel = 'A' | 'B' | 'C';
export type WorkState = 'ready' | 'active' | 'waiting_condition' | 'waiting_owner' | 'done';
export type BlockerKind = 'external_dependency' | 'transient' | 'capability_gap' | 'authorization' | 'unknown';

export interface SafeWorkCandidate {
  workId: string;
  priority: number;
  level: WorkSafetyLevel;
  authorized?: boolean;
  resourceScope: string;
}

export interface BlockedWorkInput {
  workId: string;
  blocker: BlockerKind;
  dependencyKey?: string;
  mutationInFlight: boolean;
  currentResourceScope: string;
  candidates: SafeWorkCandidate[];
}

export interface BlockedWorkPlan {
  workId: string;
  state: Extract<WorkState, 'waiting_condition' | 'waiting_owner'>;
  releaseLease: boolean;
  dependencyWatch: boolean;
  ownerActionRequired: boolean;
  nextWorkId?: string;
  retry: { maxAttempts: number; backoffSeconds: number[] };
}

export interface AutonomyTaskPolicy {
  level: WorkSafetyLevel;
  resourceScope: string;
  authorized: boolean;
}

export interface AutonomyTaskDescriptor {
  taskId: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  constraints: string[];
}

export type SelfAuditFindingKind = 'bug' | 'manual_work' | 'self_heal' | 'observability' | 'small_improvement';

export interface SelfAuditFinding {
  workId: string;
  kind: SelfAuditFindingKind;
  level: WorkSafetyLevel;
  resourceScope: string;
  evidenceRefs: string[];
  acceptanceCriteria: string[];
  rollback: string;
  ownerConflict?: boolean;
}

export interface NearEmptyAuditInput {
  eligibleWorkCount: number;
  primaryWaiting: boolean;
  mutationInFlight: boolean;
  findings: SelfAuditFinding[];
  maxNewWork?: number;
}

export interface NearEmptyAuditPlan {
  triggered: boolean;
  reason: 'near_empty' | 'waiting' | 'mutation_in_flight' | 'not_needed';
  selected: SelfAuditFinding[];
}

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;
const SELF_AUDIT_PRIORITY: Record<SelfAuditFindingKind, number> = {
  bug: 0,
  manual_work: 1,
  self_heal: 2,
  observability: 3,
  small_improvement: 4,
};
const LEVEL_PREFIX = 'autonomy:level=';
const RESOURCE_PREFIX = 'autonomy:resource=';
const AUTHORIZED = 'autonomy:authorized=true';

export function parseAutonomyPolicy(constraints: string[]): AutonomyTaskPolicy | undefined {
  const levelValue = constraints.find((value) => value.startsWith(LEVEL_PREFIX))?.slice(LEVEL_PREFIX.length);
  const resourceScope = constraints.find((value) => value.startsWith(RESOURCE_PREFIX))?.slice(RESOURCE_PREFIX.length).trim();
  if (!levelValue || !resourceScope || !['A', 'B', 'C'].includes(levelValue)) return undefined;
  return {
    level: levelValue as WorkSafetyLevel,
    resourceScope,
    authorized: constraints.includes(AUTHORIZED),
  };
}

export function safeCandidateFromTask(task: AutonomyTaskDescriptor): SafeWorkCandidate | undefined {
  const policy = parseAutonomyPolicy(task.constraints);
  if (!policy) return undefined;
  return {
    workId: task.taskId,
    priority: PRIORITY_ORDER[task.priority],
    level: policy.level,
    authorized: policy.authorized,
    resourceScope: policy.resourceScope,
  };
}

function isRunnable(candidate: SafeWorkCandidate, blockedScope: string): boolean {
  if (candidate.resourceScope === blockedScope) return false;
  if (candidate.level === 'A') return true;
  if (candidate.level === 'B') return candidate.authorized === true;
  return false;
}

export function planBlockedWork(input: BlockedWorkInput): BlockedWorkPlan {
  const ownerActionRequired = input.blocker === 'authorization';
  const next = [...input.candidates]
    .filter((candidate) => isRunnable(candidate, input.currentResourceScope))
    .sort((a, b) => a.priority - b.priority || a.workId.localeCompare(b.workId))[0];

  return {
    workId: input.workId,
    state: ownerActionRequired ? 'waiting_owner' : 'waiting_condition',
    releaseLease: !input.mutationInFlight,
    dependencyWatch: Boolean(input.dependencyKey) && !ownerActionRequired,
    ownerActionRequired,
    nextWorkId: next?.workId,
    retry: {
      maxAttempts: input.blocker === 'transient' ? 3 : 1,
      backoffSeconds: input.blocker === 'transient' ? [30, 120, 300] : [300],
    },
  };
}

export function planNearEmptyAudit(input: NearEmptyAuditInput): NearEmptyAuditPlan {
  if (input.mutationInFlight) return { triggered: false, reason: 'mutation_in_flight', selected: [] };
  const nearEmpty = input.eligibleWorkCount <= 1;
  if (!nearEmpty && !input.primaryWaiting) return { triggered: false, reason: 'not_needed', selected: [] };

  const maxNewWork = Math.max(0, Math.min(3, input.maxNewWork ?? 3));
  const selected = input.findings
    .filter((finding) => finding.level === 'A')
    .filter((finding) => !finding.ownerConflict)
    .filter((finding) => finding.workId.trim().length > 0 && finding.resourceScope.trim().length > 0)
    .filter((finding) => finding.evidenceRefs.length > 0 && finding.acceptanceCriteria.length > 0 && finding.rollback.trim().length > 0)
    .sort((a, b) => SELF_AUDIT_PRIORITY[a.kind] - SELF_AUDIT_PRIORITY[b.kind] || a.workId.localeCompare(b.workId))
    .slice(0, maxNewWork);

  return {
    triggered: true,
    reason: input.primaryWaiting ? 'waiting' : 'near_empty',
    selected,
  };
}
