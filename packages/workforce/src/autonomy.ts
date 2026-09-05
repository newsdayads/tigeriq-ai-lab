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

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;
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
