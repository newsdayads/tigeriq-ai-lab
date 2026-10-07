import { describe, expect, it } from 'vitest';
import {
  buildCheckpointMetadata,
  normalizeEvent,
  normalizeObjective,
  normalizeResource,
  normalizeTask,
  normalizeWorldModelRecord,
  sideEffectIdempotencyKey,
  stableObjectiveThreadId,
  stableRunId,
} from '../apps/tigeriq-core/world-model-contract.mjs';

const objective = {
  id: 'OBJ-GH-4527',
  priority: 'P1',
  goal: 'Persist a compact authoritative work graph',
  state: 'running',
  owner_gate: null,
  source_revision: 'main@abc123',
};

const task = {
  id: 'TASK-4527-1',
  objective_id: objective.id,
  title: 'Validate world model contract',
  state: 'runnable',
  priority: 'P1',
  dependencies: [],
  capability: 'coding',
  skills: ['core-manager-planner'],
  resource_scope: 'TIGERIQ_CORE_VNEXT_WORLD_MODEL_CONTRACT_V1',
  acceptance: ['validator deterministic'],
  evidence_required: ['unit-test-pass'],
  blocked_reason: null,
  retry_policy: { max_attempts: 3, same_signature_limit: 1, backoff_ms: 5000 },
  estimated_effort_class: 'S',
  concurrency_group: 'world-model',
  assigned_resource: 'NV09',
  checkpoint_id: null,
  last_progress_at: '2026-10-08T04:00:00+07:00',
};

describe('Core vNext world model contract', () => {
  it('normalizes OBJECTIVE, TASK, RESOURCE and EVENT records deterministically', () => {
    expect(normalizeObjective(objective)).toEqual(objective);

    const normalizedTask = normalizeTask(task);
    expect(normalizedTask.objective_id).toBe(objective.id);
    expect(normalizedTask.retry_policy).toEqual({
      max_attempts: 3,
      same_signature_limit: 1,
      backoff_ms: 5000,
    });
    expect(normalizedTask.last_progress_at).toBe('2026-10-07T21:00:00.000Z');

    expect(normalizeResource({
      id: 'NV20',
      health: 'ready',
      capability: ['reasoning', 'review'],
      skills: ['core-acceptance-verifier'],
      quota: 0.82,
      latency_ms: 1400,
      success_rate: 0.99,
      current_lease: {
        lease_id: 'lease-1',
        resource_scope: 'REVIEW_SCOPE',
        expires_at: '2026-10-08T05:00:00+07:00',
      },
      current_work: 'TASK-4527-2',
    })).toMatchObject({
      id: 'NV20',
      quota: 0.82,
      success_rate: 0.99,
      current_work: 'TASK-4527-2',
    });

    expect(normalizeEvent({
      id: 'EV-1',
      objective_id: objective.id,
      task_id: task.id,
      from_state: 'running',
      to_state: 'done',
      evidence: ['ci:37689934469'],
      source: 'github',
      occurred_at: '2026-10-08T04:10:00+07:00',
    })).toMatchObject({
      id: 'EV-1',
      from_state: 'running',
      to_state: 'done',
      source: 'github',
    });

    expect(normalizeWorldModelRecord('objective', objective)).toEqual(objective);
  });

  it('rejects invalid dependency, priority and resource quality data', () => {
    expect(() => normalizeTask({ ...task, dependencies: [task.id] }))
      .toThrow('WORLD_MODEL_TASK_SELF_DEPENDENCY');
    expect(() => normalizeObjective({ ...objective, priority: 'P9' }))
      .toThrow('WORLD_MODEL_PRIORITY_INVALID');
    expect(() => normalizeResource({
      id: 'NV20',
      health: 'ready',
      capability: 'review',
      skills: [],
      quota: null,
      latency_ms: null,
      success_rate: 1.2,
      current_lease: null,
      current_work: null,
    })).toThrow('WORLD_MODEL_RESOURCE_SUCCESS_RATE_INVALID');
  });

  it('derives stable objective/thread/run identifiers from authoritative source revisions', () => {
    const threadA = stableObjectiveThreadId(objective.id);
    const threadB = stableObjectiveThreadId(objective.id);
    expect(threadA).toBe(threadB);

    const runA = stableRunId({
      objective_id: objective.id,
      source_revision: 'main@abc123',
      plan_revision: '7',
    });
    const runB = stableRunId({
      objective_id: objective.id,
      source_revision: 'main@abc123',
      plan_revision: '7',
    });
    const runC = stableRunId({
      objective_id: objective.id,
      source_revision: 'main@def456',
      plan_revision: '7',
    });
    expect(runA).toBe(runB);
    expect(runC).not.toBe(runA);
  });

  it('builds immutable checkpoint metadata with monotonic sequence input', () => {
    const metadata = buildCheckpointMetadata({
      objective_id: objective.id,
      run_id: 'tiq-run-123',
      checkpoint_id: 'cp-0003',
      sequence: 3,
      source_revision: 'main@abc123',
      created_at: '2026-10-08T04:20:00+07:00',
    });
    expect(metadata).toEqual({
      objective_id: objective.id,
      run_id: 'tiq-run-123',
      checkpoint_id: 'cp-0003',
      sequence: 3,
      source_revision: 'main@abc123',
      created_at: '2026-10-07T21:20:00.000Z',
    });
    expect(Object.isFrozen(metadata)).toBe(true);
  });

  it('derives deterministic side-effect idempotency keys and scopes them by source revision', () => {
    const base = {
      objective_id: objective.id,
      task_id: task.id,
      effect: 'github-merge-pr-999',
      source_revision: 'main@abc123',
    };
    const first = sideEffectIdempotencyKey(base);
    expect(first).toBe(sideEffectIdempotencyKey(base));
    expect(first).toMatch(/^tiq-idem-v1-[a-f0-9]{64}$/);
    expect(sideEffectIdempotencyKey({ ...base, source_revision: 'main@def456' })).not.toBe(first);
    expect(sideEffectIdempotencyKey({ ...base, effect: 'publish-live' })).not.toBe(first);
  });
});
