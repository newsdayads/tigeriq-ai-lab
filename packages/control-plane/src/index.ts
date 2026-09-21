import { createHash } from 'node:crypto';
import { setAgentStatus } from './dbHelpers.js';
import type { AuditLogEntry } from '../../audit-log/src/index.js';
import type { EvidenceRecord } from '../../evidence/src/index.js';
import type { Gate } from '../../gate-engine/src/index.js';
import type {
  CoreWorkItemProjection,
  CoreWorkItemStatus,
  ScopeLeaseProjection,
  WorkOrder,
  WorkOrderProjectionMetadataPatch,
  WorkOrderStatus,
} from '../../work-orders/src/index.js';
import { validateWorkOrder } from '../../work-orders/src/index.js';

export { UnifiedWorkItem, projectWorkItem } from './unifiedWorkItem.js';
export type ActorRole = 'planner' | 'approver' | 'coder' | 'reviewer' | 'judge' | 'operator';
export function validateAgentDoctor(id: string): boolean { return /^NV(1[1-9]|20|10)$/.test(id); }
export { agentStatusStore, getAgentStatus, getAgentStatuses, getAgentTelemetry } from './dbHelpers.js';

export interface Actor {
  id: string;
  role: ActorRole;
}

export interface GateDecision {
  gate: Gate;
  status: 'pass' | 'fail' | 'blocked';
  evaluatorId: string;
  evidenceIds: string[];
  timestamp: string;
  reason?: string;
}

export interface WorkOrderSnapshot {
  order: WorkOrder;
  implementerId?: string;
  evidence: readonly EvidenceRecord[];
  decisions: readonly GateDecision[];
  audit: readonly AuditLogEntry[];
}

const allowedTransitions: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  draft: ['approved', 'blocked'],
  approved: ['running', 'blocked'],
  running: ['failed', 'blocked', 'verified'],
  failed: ['running', 'blocked'],
  blocked: ['approved', 'running'],
  verified: [],
};

export function projectCoreWorkItem(snapshot: WorkOrderSnapshot): CoreWorkItemProjection {
  const latestDecision = snapshot.decisions.at(-1);
  const status = canonicalStatus(snapshot, latestDecision);
  const timestamps = projectionTimestamps(snapshot);
  const evidenceRefs = unique([
    ...(snapshot.order.evidenceRefs ?? []),
    ...snapshot.evidence.flatMap((record) => record.artifactUris ?? []),
  ]);
  const blockers = projectionBlockers(snapshot, latestDecision);
  return {
    workItemId: snapshot.order.id,
    sourceRef: snapshot.order.sourceRef ?? snapshot.order.issueRef ?? null,
    issueRef: snapshot.order.issueRef ?? null,
    pr: snapshot.order.pr ?? null,
    kind: snapshot.order.kind ?? inferKind(snapshot),
    status,
    assignedExecutor: snapshot.order.assignedExecutor ?? snapshot.implementerId ?? null,
    implementer: snapshot.implementerId ?? null,
    reviewer: latestDecision?.evaluatorId ?? snapshot.order.reviewer ?? null,
    stage: snapshot.order.stage ?? latestDecision?.gate ?? snapshot.order.status,
    priority: snapshot.order.priority ?? null,
    scopeLease: projectedScopeLease(snapshot, status),
    blockers,
    evidenceRefs,
    nextAction: projectedNextAction(snapshot.order.nextAction, status, blockers),
    timestamps,
  };
}

export class ControlPlane {
  readonly #orders = new Map<string, WorkOrderSnapshot>();
  readonly #agentTelemetry = new Map<string, number>();

  constructor(snapshots: readonly WorkOrderSnapshot[] = []) {
    for (const snapshot of snapshots) {
      if (this.#orders.has(snapshot.order.id)) throw new Error(`duplicate snapshot ${snapshot.order.id}`);
      this.#orders.set(snapshot.order.id, structuredClone(snapshot));
    }
  }

  create(order: WorkOrder, actor: Actor): WorkOrderSnapshot {
    if (actor.role !== 'planner') throw new Error('only a planner can create a work order');
    const errors = validateWorkOrder(order);
    if (errors.length > 0) throw new Error(`invalid work order: ${errors.join(', ')}`);
    if (order.status !== 'draft') throw new Error('a new work order must start as draft');
    if (this.#orders.has(order.id)) throw new Error(`work order ${order.id} already exists`);
    const snapshot: WorkOrderSnapshot = { order: structuredClone(order), evidence: [], decisions: [], audit: [] };
    const result = this.#withAudit(snapshot, actor, 'work-order.created');
    this.#orders.set(order.id, result);
    return structuredClone(result);
  }

  transition(id: string, status: WorkOrderStatus, actor: Actor): WorkOrderSnapshot {
    const current = this.#require(id);
    if (!allowedTransitions[current.order.status].includes(status)) {
      throw new Error(`invalid transition ${current.order.status} -> ${status}`);
    }
    if (status === 'approved' && actor.role !== 'approver') throw new Error('approval requires an approver');
    if (status === 'running' && actor.role !== 'coder') throw new Error('execution requires a coder');
    if (status === 'verified') throw new Error('verified is produced only by recordGateDecision');
    const updated: WorkOrderSnapshot = {
      ...current,
      order: { ...current.order, status },
      ...(status === 'running' ? { implementerId: actor.id } : {}),
    };
    return this.#save(id, this.#withAudit(updated, actor, `work-order.${status}`));
  }

  recordEvidence(id: string, record: EvidenceRecord, actor: Actor): WorkOrderSnapshot {
    const current = this.#require(id);
    if (current.order.status !== 'running') throw new Error('evidence is accepted only while running');
    if (record.workOrderId !== id) throw new Error('evidence workOrderId mismatch');
    if (record.id.trim().length === 0 || record.command.trim().length === 0) throw new Error('evidence identity and command are required');
    if (current.evidence.some((item) => item.id === record.id)) throw new Error(`evidence ${record.id} already exists`);
    const normalized: EvidenceRecord = {
      ...structuredClone(record),
      logDigest: record.logDigest ?? digest(JSON.stringify(record)),
    };
    const updated = { ...current, evidence: [...current.evidence, Object.freeze(normalized)] };
    return this.#save(id, this.#withAudit(updated, actor, 'evidence.recorded', { evidenceId: record.id }));
  }

  recordGateDecision(id: string, decision: GateDecision, actor: Actor): WorkOrderSnapshot {
    const current = this.#require(id);
    if (actor.role !== 'reviewer' && actor.role !== 'judge') throw new Error('gate evaluation requires reviewer or judge role');
    if (decision.evaluatorId !== actor.id) throw new Error('evaluator identity mismatch');
    if (current.implementerId === actor.id) throw new Error('implementer cannot evaluate its own work');
    if (decision.evidenceIds.length === 0) throw new Error('a gate decision requires evidence');
    const known = new Set(current.evidence.map((item) => item.id));
    if (decision.evidenceIds.some((evidenceId) => !known.has(evidenceId))) throw new Error('gate references unknown evidence');
    if (decision.status === 'pass') {
      const selected = current.evidence.filter((item) => decision.evidenceIds.includes(item.id));
      if (selected.some((item) => item.status !== 'pass' || item.exitCode !== 0)) throw new Error('passing gate contains failing evidence');
    }
    const nextStatus: WorkOrderStatus = decision.status === 'pass' && decision.gate === 'DONE'
      ? 'verified'
      : decision.status === 'fail' ? 'failed' : current.order.status;
    const updated: WorkOrderSnapshot = {
      ...current,
      order: { ...current.order, status: nextStatus },
      decisions: [...current.decisions, Object.freeze(structuredClone(decision))],
    };
    return this.#save(id, this.#withAudit(updated, actor, `gate.${decision.status}`, { gate: decision.gate }));
  }

  updateProjectionMetadata(id: string, patch: WorkOrderProjectionMetadataPatch, actor: Actor): WorkOrderSnapshot {
    if (!['planner', 'coder', 'reviewer', 'operator'].includes(actor.role)) {
      throw new Error('projection metadata update requires planner, coder, reviewer, or operator role');
    }
    const current = this.#require(id);
    const updatedOrder: WorkOrder = { ...current.order, ...structuredClone(patch) };
    const errors = validateWorkOrder(updatedOrder);
    if (errors.length > 0) throw new Error(`invalid work order: ${errors.join(', ')}`);
    if (!projectionMetadataChanged(current.order, updatedOrder)) return structuredClone(current);

    const updated: WorkOrderSnapshot = { ...current, order: updatedOrder };
    return this.#save(id, this.#withAudit(updated, actor, 'projection-metadata.updated', {
      fields: Object.keys(patch).sort(),
    }));
  }

  get(id: string): WorkOrderSnapshot {
    return structuredClone(this.#require(id));
  }

  list(): WorkOrderSnapshot[] {
    return [...this.#orders.values()].map((snapshot) => structuredClone(snapshot));
  }

  recordTelemetry(actorId: string, metrics: { requestCount: number }) {
    const count = this.#agentTelemetry.get(actorId) ?? 0;
    this.#agentTelemetry.set(actorId, count + metrics.requestCount);
    setAgentStatus(actorId, 'active', { requestCount: count + metrics.requestCount });
  }

  getAgentTelemetry() {
    const total = [...this.#agentTelemetry.values()].reduce((a, b) => a + b, 0);
    return { requestCount: total };
  }

  #require(id: string): WorkOrderSnapshot {
    const value = this.#orders.get(id);
    if (!value) throw new Error(`work order ${id} not found`);
    return value;
  }

  #save(id: string, snapshot: WorkOrderSnapshot): WorkOrderSnapshot {
    this.#orders.set(id, snapshot);
    return structuredClone(snapshot);
  }

  #withAudit(snapshot: WorkOrderSnapshot, actor: Actor, action: string, metadata?: Record<string, unknown>): WorkOrderSnapshot {
    const previous = snapshot.audit.at(-1);
    const entry: AuditLogEntry = Object.freeze({
      id: randomUUID(), actor: actor.id, role: actor.role, action, target: snapshot.order.id,
      workOrderId: snapshot.order.id, metadata: { ...metadata, previousHash: previous ? digest(JSON.stringify(previous)) : null },
      timestamp: new Date().toISOString(),
    });
    return { ...snapshot, audit: [...snapshot.audit, entry] };
  }
}

function canonicalStatus(snapshot: WorkOrderSnapshot, latestDecision: GateDecision | undefined): CoreWorkItemStatus {
  if (snapshot.order.status === 'draft') return 'QUEUED';
  if (snapshot.order.status === 'approved') return 'CLAIMED';
  if (snapshot.order.status === 'verified') return 'DONE';
  if (snapshot.order.status === 'failed' || snapshot.order.status === 'blocked') return 'BLOCKED';
  if (latestDecision?.status === 'fail' || latestDecision?.status === 'blocked') return 'BLOCKED';
  if (snapshot.order.status === 'running' && snapshot.evidence.length === 0) return 'WORKING';
  if (snapshot.order.status === 'running' && !latestDecision) return 'EVIDENCE';
  return 'VERIFY';
}

function projectedScopeLease(snapshot: WorkOrderSnapshot, status: CoreWorkItemStatus): ScopeLeaseProjection | null {
  const base = snapshot.order.scopeLease ?? (snapshot.implementerId
    ? { ownerId: snapshot.implementerId, scope: snapshot.order.scope, state: 'unknown' as const }
    : null);
  if (!base) return null;
  return { ...base, state: projectedScopeLeaseState(status) };
}

function projectedScopeLeaseState(status: CoreWorkItemStatus): ScopeLeaseProjection['state'] {
  if (status === 'DONE') return 'released';
  if (status === 'BLOCKED') return 'blocked';
  if (status === 'QUEUED') return 'unknown';
  return 'active';
}

function projectionTimestamps(snapshot: WorkOrderSnapshot): CoreWorkItemProjection['timestamps'] {
  return {
    createdAt: snapshot.audit[0]?.timestamp ?? null,
    startedAt: snapshot.audit.find((entry) => entry.action === 'work-order.running')?.timestamp ?? null,
    lastActivityAt: snapshot.audit.at(-1)?.timestamp ?? null,
    completedAt: snapshot.order.status === 'verified' || snapshot.order.status === 'failed' || snapshot.order.status === 'blocked'
      ? snapshot.audit.at(-1)?.timestamp ?? null
      : null,
  };
}

function projectionBlockers(snapshot: WorkOrderSnapshot, latestDecision: GateDecision | undefined): string[] {
  return unique([
    ...(snapshot.order.blockers ?? []),
    ...snapshot.evidence
      .filter((record) => record.status !== 'pass' || record.exitCode !== 0)
      .map((record) => `${record.gate}:${record.status}:exitCode=${record.exitCode}`),
    ...(latestDecision?.status === 'fail' || latestDecision?.status === 'blocked'
      ? [`${latestDecision.gate}:${latestDecision.status}${latestDecision.reason ? `:${latestDecision.reason}` : ''}`]
      : []),
    ...(snapshot.order.status === 'failed' || snapshot.order.status === 'blocked' ? [snapshot.order.status] : []),
  ]);
}

function projectedNextAction(ownerNextAction: string | undefined, status: CoreWorkItemStatus, blockers: readonly string[]): string | null {
  if (status === 'QUEUED' || status === 'CLAIMED' || status === 'WORKING') return ownerNextAction ?? defaultNextAction(status, blockers);
  return defaultNextAction(status, blockers);
}

function defaultNextAction(status: CoreWorkItemStatus, blockers: readonly string[]): string | null {
  if (status === 'DONE') return null;
  if (status === 'BLOCKED') return blockers[0] ? 'Resolve blocker and retry safely' : 'Resolve blocker';
  if (status === 'QUEUED') return 'Claim work item';
  if (status === 'CLAIMED') return 'Start execution';
  if (status === 'WORKING') return 'Attach evidence';
  if (status === 'EVIDENCE') return 'Run independent verification';
  return 'Finish verification';
}

function inferKind(snapshot: WorkOrderSnapshot): CoreWorkItemProjection['kind'] {
  const text = `${snapshot.order.id} ${snapshot.order.project} ${snapshot.order.goal} ${snapshot.order.scope.join(' ')}`.toLowerCase();
  if (text.includes('chrome') || text.includes('nv02')) return 'ui';
  if (text.includes('coding') || text.includes('github') || text.includes('pr') || snapshot.order.pr) return 'coding';
  if (text.includes('review')) return 'review';
  if (text.includes('research')) return 'research';
  return 'general';
}

function projectionMetadataChanged(before: WorkOrder, after: WorkOrder): boolean {
  const fields: readonly (keyof WorkOrderProjectionMetadataPatch)[] = [
    'issueRef', 'sourceRef', 'pr', 'kind', 'assignedExecutor', 'reviewer', 'stage', 'priority',
    'scopeLease', 'blockers', 'evidenceRefs', 'nextAction',
  ];
  return fields.some((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
