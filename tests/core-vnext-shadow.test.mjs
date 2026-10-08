import { describe, expect, it } from 'vitest';
import { evaluateCoreVNextShadowCycle } from '../apps/tigeriq-core/core-vnext-shadow.mjs';

const nowMs = Date.parse('2026-10-08T06:00:00+07:00');

const objective = {
  id: 'OBJ-GH-4457',
  priority: 'P1',
  goal: 'Core vNext shadow integration',
  state: 'running',
  owner_gate: null,
  source_revision: 'main@abc123',
};

const task = {
  id: 'TASK-1',
  objective_id: objective.id,
  title: 'Run scheduler shadow',
  state: 'ready',
  priority: 'P1',
  dependencies: [],
  capability: 'reasoning',
  skills: ['core-resource-scheduler'],
  resource_scope: 'SCOPE-1',
  acceptance: ['dispatch deterministic'],
  evidence_required: ['shadow result'],
  blocked_reason: null,
  retry_policy: { max_attempts: 3, same_signature_limit: 1, backoff_ms: 1000 },
  estimated_effort_class: 'S',
  concurrency_group: 'g1',
  assigned_resource: null,
  checkpoint_id: null,
  last_progress_at: '2026-10-08T05:30:00+07:00',
};

const resource = {
  id: 'NV12',
  health: 'ready',
  capability: ['reasoning'],
  skills: ['core-resource-scheduler'],
  quota: 1,
  latency_ms: 250,
  success_rate: 0.99,
  current_lease: null,
  current_work: null,
};

describe('Core vNext shadow integration', () => {
  it('is inert while the shadow flag is OFF and never touches pool', () => {
    const pool = new Proxy({}, {
      get() {
        throw new Error('pool must not be touched when shadow is disabled');
      },
    });
    const result = evaluateCoreVNextShadowCycle({
      env: {},
      pool,
      objective,
      tasks: [task],
      resources: [resource],
      nowMs,
    });
    expect(result).toEqual({
      enabled: false,
      foundationReady: false,
      planDecision: null,
      eventDecision: null,
      schedule: { dispatches: [], idle: true, reason: 'shadow_disabled' },
      noProgress: null,
      threadId: null,
      runId: null,
      checkpoint: null,
    });
  });

  it('composes world model, plan governor, scheduler and checkpoint contracts when enabled', () => {
    const pool = { connect: () => { throw new Error('shadow evaluation must not connect'); } };
    const planDelta = {
      schema: 'TIGERIQ_PLAN_DELTA_V1',
      objectiveId: objective.id,
      sourceRevision: objective.source_revision,
      assessment: { state: 'continue', summary: 'continue safe shadow evaluation' },
      tasks: [{
        id: 'PLAN-1',
        title: 'Evaluate scheduler shadow',
        action: 'create',
        capability: 'reasoning',
        priority: 'P1',
        resourceScope: 'PLAN-SCOPE-1',
        dependencies: [],
        acceptance: ['shadow only'],
        evidenceRequired: ['unit test'],
        concurrencyGroup: 'shadow',
        estimatedEffortClass: 'S',
        preferredSkills: ['core-resource-scheduler'],
        effects: {
          repoMutation: false,
          productionRelease: false,
          paidCost: false,
          credentialChange: false,
          securityBoundaryChange: false,
          destructive: false,
        },
        implementerResourceId: 'NV12',
        reviewerResourceId: 'NV13',
      }],
      criticalPath: ['PLAN-1'],
      parallelGroups: [{ id: 'g1', tasks: ['PLAN-1'] }],
      replanTriggers: ['resource health changes'],
    };

    const result = evaluateCoreVNextShadowCycle({
      env: { TIGERIQ_CORE_VNEXT_LANGGRAPH_SHADOW: 'true' },
      pool,
      objective,
      tasks: [task],
      resources: [resource],
      planDelta,
      event: { type: 'new_work' },
      checkpointSequence: 4,
      maxDispatches: 1,
      nowMs,
    });

    expect(result.enabled).toBe(true);
    expect(result.foundationReady).toBe(true);
    expect(result.planDecision).toMatchObject({ decision: 'accept', reason: 'PLAN_SAFE' });
    expect(result.eventDecision.reconcile).toBe(true);
    expect(result.schedule.dispatches).toHaveLength(1);
    expect(result.schedule.dispatches[0]).toMatchObject({ taskId: 'TASK-1', resourceId: 'NV12' });
    expect(result.schedule.dispatches[0].idempotencyKey).toMatch(/^tiq-idem-v1-[a-f0-9]{64}$/);
    expect(result.threadId).toMatch(/^tiq-objective-/);
    expect(result.runId).toMatch(/^tiq-run-/);
    expect(result.checkpoint).toMatchObject({
      objective_id: objective.id,
      sequence: 4,
      source_revision: objective.source_revision,
    });
    expect(result.noProgress.currentSignature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not dispatch when the event does not require reconciliation', () => {
    const result = evaluateCoreVNextShadowCycle({
      env: { TIGERIQ_CORE_VNEXT_LANGGRAPH_SHADOW: 'true' },
      pool: {},
      objective,
      tasks: [task],
      resources: [resource],
      event: { type: 'heartbeat' },
      nowMs,
    });
    expect(result.schedule).toMatchObject({
      dispatches: [],
      idle: true,
      reason: 'event_does_not_require_reconcile',
    });
  });

  it('never proposes tasks under owner hold or hard gate after normalization', () => {
    const gatedTasks = [
      { ...task, id: 'TASK-HOLD', resource_scope: 'SCOPE-HOLD', owner_hold: true },
      { ...task, id: 'TASK-HARD', resource_scope: 'SCOPE-HARD', hard_gate: true },
    ];
    const run = rows => evaluateCoreVNextShadowCycle({
      env: { TIGERIQ_CORE_VNEXT_LANGGRAPH_SHADOW: 'true' },
      pool: {},
      objective,
      tasks: rows,
      resources: [resource],
      event: { type: 'new_work' },
      nowMs,
      maxDispatches: 3,
    });
    expect(run(gatedTasks).schedule).toMatchObject({ dispatches: [], idle: true });
    const safe = run([...gatedTasks, { ...task, id: 'TASK-SAFE', resource_scope: 'SCOPE-SAFE' }]);
    expect(safe.schedule.dispatches).toHaveLength(1);
    expect(safe.schedule.dispatches[0].taskId).toBe('TASK-SAFE');
    expect(safe.tasks[0]).toMatchObject({ owner_hold: true, hard_gate: false });
    expect(safe.tasks[1]).toMatchObject({ owner_hold: false, hard_gate: true });
  });

  it('blocks all dispatch proposals for gated objectives and P0 objectives', () => {
    const run = guardedObjective => evaluateCoreVNextShadowCycle({
      env: { TIGERIQ_CORE_VNEXT_LANGGRAPH_SHADOW: 'true' },
      pool: {},
      objective: guardedObjective,
      tasks: [task],
      resources: [resource],
      event: { type: 'new_work' },
      nowMs,
    });
    for (const guardedObjective of [
      { ...objective, owner_gate: 'OWNER_HOLD' },
      { ...objective, priority: 'P0' },
    ]) {
      const result = run(guardedObjective);
      expect(result.enabled).toBe(true);
      expect(result.schedule).toEqual({
        dispatches: [],
        idle: true,
        reason: 'objective_owner_gate',
      });
    }
  });

});
