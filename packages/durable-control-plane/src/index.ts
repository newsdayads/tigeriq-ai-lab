import { ControlPlane, type Actor, type GateDecision, type WorkOrderSnapshot } from '../../control-plane/src/index.js';
import type { EvidenceRecord } from '../../evidence/src/index.js';
import { FileJournal } from '../../event-store/src/index.js';
import type { WorkOrder, WorkOrderStatus } from '../../work-orders/src/index.js';

export class DurableControlPlane {
  readonly #journal: FileJournal;

  constructor(journal: FileJournal) {
    this.#journal = journal;
  }

  async create(order: WorkOrder, actor: Actor): Promise<WorkOrderSnapshot> {
    const snapshot = new ControlPlane().create(order, actor);
    await this.#journal.append(order.id, 0, { type: 'snapshot.created', actor: actor.id, payload: snapshot });
    return snapshot;
  }

  async transition(id: string, status: WorkOrderStatus, actor: Actor): Promise<WorkOrderSnapshot> {
    return this.#mutate(id, actor, 'snapshot.transitioned', (plane) => plane.transition(id, status, actor));
  }

  async recordEvidence(id: string, evidence: EvidenceRecord, actor: Actor): Promise<WorkOrderSnapshot> {
    return this.#mutate(id, actor, 'snapshot.evidence-recorded', (plane) => plane.recordEvidence(id, evidence, actor));
  }

  async recordGateDecision(id: string, decision: GateDecision, actor: Actor): Promise<WorkOrderSnapshot> {
    return this.#mutate(id, actor, 'snapshot.gate-decided', (plane) => plane.recordGateDecision(id, decision, actor));
  }

  async get(id: string): Promise<WorkOrderSnapshot> {
    return (await this.#load(id)).snapshot;
  }

  async #mutate(
    id: string,
    actor: Actor,
    type: string,
    mutation: (plane: ControlPlane) => WorkOrderSnapshot,
  ): Promise<WorkOrderSnapshot> {
    const { snapshot, version } = await this.#load(id);
    const next = mutation(new ControlPlane([snapshot]));
    await this.#journal.append(id, version, { type, actor: actor.id, payload: next });
    return next;
  }

  async #load(id: string): Promise<{ snapshot: WorkOrderSnapshot; version: number }> {
    const entries = await this.#journal.readStream<WorkOrderSnapshot>(id);
    const latest = entries.at(-1);
    if (!latest) throw new Error(`work order ${id} not found`);
    return { snapshot: latest.payload, version: entries.length };
  }
}
