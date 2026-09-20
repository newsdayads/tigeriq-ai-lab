export type WorkOrderStatus = 'draft' | 'approved' | 'running' | 'failed' | 'blocked' | 'verified';

export type CoreWorkItemStatus = 'QUEUED' | 'CLAIMED' | 'WORKING' | 'EVIDENCE' | 'VERIFY' | 'DONE' | 'BLOCKED';
export type CoreWorkItemKind = 'ui' | 'coding' | 'review' | 'research' | 'general';

export interface ScopeLeaseProjection {
  ownerId: string;
  scope: string[];
  state: 'active' | 'released' | 'blocked' | 'unknown';
  expiresAt?: string;
}

export interface CoreWorkItemProjection {
  workItemId: string;
  sourceRef: string | null;
  issueRef: string | null;
  pr: string | null;
  kind: CoreWorkItemKind;
  status: CoreWorkItemStatus;
  assignedExecutor: string | null;
  implementer: string | null;
  reviewer: string | null;
  stage: string;
  priority: string | null;
  scopeLease: ScopeLeaseProjection | null;
  blockers: string[];
  evidenceRefs: string[];
  nextAction: string | null;
  timestamps: {
    createdAt: string | null;
    startedAt: string | null;
    lastActivityAt: string | null;
    completedAt: string | null;
  };
}

export interface WorkOrder {
  id: string;
  project: string;
  goal: string;
  scope: string[];
  invariants: string[];
  acceptanceCriteria: string[];
  dependencies?: string[];
  edgeCases?: string[];
  rollback?: string;
  status: WorkOrderStatus;
  issueRef?: string;
  sourceRef?: string;
  pr?: string;
  kind?: CoreWorkItemKind;
  assignedExecutor?: string;
  reviewer?: string;
  stage?: string;
  priority?: string;
  scopeLease?: ScopeLeaseProjection;
  blockers?: string[];
  evidenceRefs?: string[];
  nextAction?: string;
}

export function validateWorkOrder(order: WorkOrder): string[] {
  const errors: string[] = [];
  if (!order.id.trim()) errors.push('id is required');
  if (!order.project.trim()) errors.push('project is required');
  if (!order.goal.trim()) errors.push('goal is required');
  if (order.acceptanceCriteria.length === 0) errors.push('acceptance criteria are required');
  if (order.issueRef && !isSafeReference(order.issueRef)) errors.push('issueRef must be a safe reference');
  if (order.sourceRef && !isSafeReference(order.sourceRef)) errors.push('sourceRef must be a safe reference');
  if (order.pr && !isSafeReference(order.pr)) errors.push('pr must be a safe reference');
  return errors;
}

function isSafeReference(value: string): boolean {
  return value.trim().length > 0 && value.length <= 512 && !/[\u0000-\u001f]/.test(value);
}
