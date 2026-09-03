export type WorkPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type GoalStatus = 'planned' | 'running' | 'blocked' | 'failed' | 'completed' | 'cancelled';
export type WorkStage =
  | 'waiting_dependency'
  | 'ready'
  | 'leased'
  | 'running'
  | 'reviewing'
  | 'judging'
  | 'failed'
  | 'blocked'
  | 'completed'
  | 'cancelled';
export type WorkRole = 'executor' | 'reviewer' | 'judge';
export type WorkerKind = 'ai' | 'pc01' | 'device' | 'tool' | 'human';
export type ReviewVerdict = 'pass' | 'needs-work' | 'fail';
export type EvidenceKind = 'text' | 'json' | 'log' | 'commit' | 'url' | 'screenshot';

export interface GoalRequest {
  goalId: string;
  idempotencyKey: string;
  objective: string;
  priority: WorkPriority;
  constraints: string[];
  maxParallelism: number;
  createdAt: string;
}

export interface PlannedWorkItem {
  workId: string;
  title: string;
  objective: string;
  dependencies: string[];
  scopeKeys: string[];
  requiredCapabilities: string[];
  allowedWorkerKinds?: WorkerKind[];
  expectedEvidence: EvidenceKind[];
  maxAttempts: number;
  independentReview: boolean;
  judgeRequired: boolean;
}

export interface GoalPlan {
  goal: GoalRequest;
  items: PlannedWorkItem[];
}

export interface EvidenceRef {
  kind: EvidenceKind;
  ref: string;
  summary?: string;
  sha256?: string;
}

export interface ExecutionResult {
  status: 'completed' | 'failed';
  conclusion: string;
  evidence: EvidenceRef[];
  failureCode?: string;
  retriable?: boolean;
}

export interface ReviewResult {
  verdict: ReviewVerdict;
  conclusion: string;
  evidence: EvidenceRef[];
  retriable?: boolean;
}

export interface ManagedWorker {
  workerId: string;
  kind: WorkerKind;
  roles: WorkRole[];
  capabilities: string[];
  concurrencyLimit: number;
  allowedScopes?: string[];
  /** Stable identity for independence checks, e.g. provider:model or a hardware/runtime fingerprint. */
  independenceKey: string;
  online: boolean;
}

export interface WorkDriver {
  execute?(context: WorkExecutionContext): Promise<ExecutionResult>;
  review?(context: WorkReviewContext): Promise<ReviewResult>;
  judge?(context: WorkJudgeContext): Promise<ReviewResult>;
}

export interface WorkExecutionContext {
  goal: GoalRequest;
  work: PlannedWorkItem;
  worker: ManagedWorker;
  attempt: number;
  /** Drivers should stop promptly when aborted; the manager still bounds waiting if they ignore it. */
  signal?: AbortSignal;
}

export interface WorkReviewContext extends WorkExecutionContext {
  execution: ExecutionResult;
}

export interface WorkJudgeContext extends WorkReviewContext {
  review: ReviewResult;
}

export interface WorkLease {
  role: WorkRole;
  workerId: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface ManagedWorkRecord {
  work: PlannedWorkItem;
  stage: WorkStage;
  attempts: number;
  executorIds: string[];
  reviewerIds: string[];
  judgeIds: string[];
  /** Persisted stable assurance identities. Optional for backward-compatible V1 snapshots; clones normalize to arrays. */
  executorIndependenceKeys?: string[];
  reviewerIndependenceKeys?: string[];
  judgeIndependenceKeys?: string[];
  lease?: WorkLease;
  execution?: ExecutionResult;
  review?: ReviewResult;
  judgment?: ReviewResult;
  lastFailureCode?: string;
}

export interface ManagedGoalRecord {
  goal: GoalRequest;
  status: GoalStatus;
  work: ManagedWorkRecord[];
}

export interface WorkHistoryEvent {
  sequence: number;
  at: string;
  goalId: string;
  workId?: string;
  type: string;
  from?: string;
  to?: string;
  actorId?: string;
  attempt?: number;
  detail?: string;
}

export interface WorkManagementSnapshot {
  version: 1;
  sequence: number;
  goals: ManagedGoalRecord[];
  history: WorkHistoryEvent[];
}

export interface GoalDecomposer {
  decompose(goal: GoalRequest): Promise<PlannedWorkItem[]>;
}

export interface RunSummary {
  goal: ManagedGoalRecord;
  cycles: number;
  reason: 'terminal' | 'waiting_worker' | 'waiting_dependency' | 'max_cycles';
}
