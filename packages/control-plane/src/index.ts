import { createHash, randomUUID } from 'node:crypto';
import type { AuditLogEntry } from '../../audit-log/src/index.js';
import type { EvidenceRecord } from '../../evidence/src/index.js';
import type { Gate } from '../../gate-engine/src/index.js';
import type { WorkOrder, WorkOrderStatus } from '../../work-orders/src/index.js';
import { validateWorkOrder } from '../../work-orders/src/index.js';

export type ActorRole = 'planner' | 'approver' | 'coder' | 'reviewer' | 'judge' | 'operator';

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

export class ControlPlane {
  readonly #orders = new Map<string, WorkOrderSnapshot>();

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

  get(id: string): WorkOrderSnapshot {
    return structuredClone(this.#require(id));
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

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
