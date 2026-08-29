import { randomUUID } from 'node:crypto';
import type { Actor, GateDecision, WorkOrderSnapshot } from '../../control-plane/src/index.js';
import type { DurableControlPlane } from '../../durable-control-plane/src/index.js';
import type { EvidenceRecord } from '../../evidence/src/index.js';
import type { ModelRouter, RoutedResult } from '../../model-router/src/index.js';

export interface WorkerActors {
  coder: Actor;
  reviewer: Actor;
  judge: Actor;
}

export interface ReviewResult {
  pass: boolean;
  reason?: string;
}

export interface WorkerReviewContext {
  workOrder: WorkOrderSnapshot;
  routed: RoutedResult;
}

export interface WorkerOptions {
  controlPlane: DurableControlPlane;
  router: ModelRouter;
  actors: WorkerActors;
  reviewer: (context: WorkerReviewContext) => Promise<ReviewResult>;
  judge: (context: WorkerReviewContext) => Promise<ReviewResult>;
  commitSha?: string;
  now?: () => Date;
}

export interface WorkerRunResult {
  snapshot: WorkOrderSnapshot;
  routed: RoutedResult;
  evidence: EvidenceRecord;
}

export class WorkOrderWorker {
  readonly #controlPlane: DurableControlPlane;
  readonly #router: ModelRouter;
  readonly #actors: WorkerActors;
  readonly #reviewer: WorkerOptions['reviewer'];
  readonly #judge: WorkerOptions['judge'];
  readonly #commitSha: string;
  readonly #now: () => Date;

  constructor(options: WorkerOptions) {
    validateActors(options.actors);
    this.#controlPlane = options.controlPlane;
    this.#router = options.router;
    this.#actors = options.actors;
    this.#reviewer = options.reviewer;
    this.#judge = options.judge;
    this.#commitSha = options.commitSha ?? 'local-worker';
    this.#now = options.now ?? (() => new Date());
  }

  async run(workOrderId: string, prompt: string): Promise<WorkerRunResult> {
    if (!workOrderId.trim()) throw new Error('workOrderId is required');
    if (!prompt.trim()) throw new Error('prompt is required');

    let snapshot = await this.#controlPlane.get(workOrderId);
    if (snapshot.order.status === 'approved' || snapshot.order.status === 'failed' || snapshot.order.status === 'blocked') {
      snapshot = await this.#controlPlane.transition(workOrderId, 'running', this.#actors.coder);
    } else if (snapshot.order.status !== 'running') {
      throw new Error(`work order ${workOrderId} is not executable from status ${snapshot.order.status}`);
    }

    let routed: RoutedResult;
    try {
      routed = await this.#router.execute({ prompt });
    } catch (error) {
      const failedEvidence = createEvidence({
        workOrderId,
        commitSha: this.#commitSha,
        command: 'model-router:exhausted',
        status: 'fail',
        exitCode: 1,
        now: this.#now,
      });
      await this.#controlPlane.recordEvidence(workOrderId, failedEvidence, this.#actors.coder);
      await this.#controlPlane.transition(workOrderId, 'failed', this.#actors.coder);
      throw error;
    }

    const evidence = createEvidence({
      workOrderId,
      commitSha: this.#commitSha,
      command: `model-router:${routed.target.provider}/${routed.target.model}`,
      status: 'pass',
      exitCode: 0,
      now: this.#now,
    });
    snapshot = await this.#controlPlane.recordEvidence(workOrderId, evidence, this.#actors.coder);

    const review = await this.#reviewer({ workOrder: snapshot, routed });
    const reviewDecision = decision('REVIEW', review, this.#actors.reviewer, evidence.id, this.#now);
    snapshot = await this.#controlPlane.recordGateDecision(workOrderId, reviewDecision, this.#actors.reviewer);
    if (!review.pass) return { snapshot, routed, evidence };

    const judgment = await this.#judge({ workOrder: snapshot, routed });
    const doneDecision = decision('DONE', judgment, this.#actors.judge, evidence.id, this.#now);
    snapshot = await this.#controlPlane.recordGateDecision(workOrderId, doneDecision, this.#actors.judge);
    return { snapshot, routed, evidence };
  }
}

function validateActors(actors: WorkerActors): void {
  if (actors.coder.role !== 'coder') throw new Error('worker coder actor must have coder role');
  if (actors.reviewer.role !== 'reviewer') throw new Error('worker reviewer actor must have reviewer role');
  if (actors.judge.role !== 'judge') throw new Error('worker judge actor must have judge role');
  const ids = new Set([actors.coder.id, actors.reviewer.id, actors.judge.id]);
  if (ids.size !== 3) throw new Error('coder, reviewer and judge must be independent');
}

function createEvidence(input: {
  workOrderId: string;
  commitSha: string;
  command: string;
  status: EvidenceRecord['status'];
  exitCode: number;
  now: () => Date;
}): EvidenceRecord {
  return {
    id: `ev-${randomUUID()}`,
    workOrderId: input.workOrderId,
    gate: 'EXECUTION',
    commitSha: input.commitSha,
    command: input.command,
    exitCode: input.exitCode,
    status: input.status,
    timestamp: input.now().toISOString(),
  };
}

function decision(
  gate: GateDecision['gate'],
  result: ReviewResult,
  actor: Actor,
  evidenceId: string,
  now: () => Date,
): GateDecision {
  return {
    gate,
    status: result.pass ? 'pass' : 'fail',
    evaluatorId: actor.id,
    evidenceIds: [evidenceId],
    timestamp: now().toISOString(),
    reason: result.reason,
  };
}
