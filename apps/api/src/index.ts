export interface HealthStatus {
  service: 'tigeriq-ai-lab-api';
  status: 'ok';
  phase: 'phase-8';
  capabilities: readonly ['work-orders', 'evidence', 'independent-gates', 'audit-chain', 'durable-journal', 'authenticated-http', 'restart-recovery', 'durable-idempotency', 'runtime-guardrails', 'overload-metrics', 'actor-rate-limits', 'canonical-workitems'];
}

export function health(): HealthStatus {
  return {
    service: 'tigeriq-ai-lab-api', status: 'ok', phase: 'phase-8',
    capabilities: ['work-orders', 'evidence', 'independent-gates', 'audit-chain', 'durable-journal', 'authenticated-http', 'restart-recovery', 'durable-idempotency', 'runtime-guardrails', 'overload-metrics', 'actor-rate-limits', 'canonical-workitems'],
  };
}

export interface CoreWorkItemProjection {
  id: string;
  status: 'QUEUED' | 'CLAIMED' | 'WORKING' | 'EVIDENCE' | 'VERIFY' | 'DONE' | 'BLOCKED';
  issueRef: string | null;
  pr: string | null;
  implementer: string | null;
  reviewer: string | null;
  stage: string;
  timestamps: Record<string, number>;
  blockers: string[];
  nextAction: string | null;
}

export function mapToCanonicalWorkItem(input: Record<string, unknown>): CoreWorkItemProjection {
  const rawStatus = String(input.status || 'draft').toLowerCase();
  let status: CoreWorkItemProjection['status'] = 'QUEUED';
  if (rawStatus === 'approved' || rawStatus === 'claimed') status = 'CLAIMED';
  else if (rawStatus === 'running' || rawStatus === 'working') status = 'WORKING';
  else if (rawStatus === 'evidence') status = 'EVIDENCE';
  else if (rawStatus === 'verified' || rawStatus === 'verify') status = 'VERIFY';
  else if (rawStatus === 'done') status = 'DONE';
  else if (rawStatus === 'failed' || rawStatus === 'blocked') status = 'BLOCKED';
  else if (['QUEUED', 'CLAIMED', 'WORKING', 'EVIDENCE', 'VERIFY', 'DONE', 'BLOCKED'].includes(String(input.status))) {
    status = input.status as CoreWorkItemProjection['status'];
  }
  return {
    id: String(input.id || ''),
    status,
    issueRef: (input.issueRef as string) || null,
    pr: (input.pr as string) || null,
    implementer: (input.implementer as string) || null,
    reviewer: (input.reviewer as string) || null,
    stage: (input.stage as string) || rawStatus,
    timestamps: (input.timestamps as Record<string, number>) || { updated: Date.now() },
    blockers: (input.blockers as string[]) || [],
    nextAction: (input.nextAction as string) || null,
  };
}
