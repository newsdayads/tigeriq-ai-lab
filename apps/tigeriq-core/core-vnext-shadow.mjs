import { createLangGraphShadowFoundation, isLangGraphShadowEnabled } from './langgraph-shadow-foundation.mjs';
import {
  buildCheckpointMetadata,
  normalizeObjective,
  normalizeResource,
  normalizeTask,
  sideEffectIdempotencyKey,
  stableObjectiveThreadId,
  stableRunId,
} from './world-model-contract.mjs';
import { governPlanDelta } from './manager-plan-delta.mjs';
import {
  noProgressGuard,
  noProgressSignature,
  reconcileSchedulerEvent,
  workStealPlan,
} from './continuous-scheduler.mjs';

function freezeArray(value) {
  return Object.freeze(Array.isArray(value) ? value : []);
}

function disabledResult() {
  return Object.freeze({
    enabled: false,
    foundationReady: false,
    planDecision: null,
    eventDecision: null,
    schedule: Object.freeze({ dispatches: freezeArray([]), idle: true, reason: 'shadow_disabled' }),
    noProgress: null,
    threadId: null,
    runId: null,
    checkpoint: null,
  });
}

export function evaluateCoreVNextShadowCycle({
  env = process.env,
  pool = null,
  objective = {},
  tasks = [],
  resources = [],
  planDelta = null,
  activeDispatchKeys = [],
  event = { type: 'new_work' },
  previousNoProgressSignature = '',
  noProgressRepeatCount = 0,
  noProgressMaxRepeats = 1,
  maxDispatches = 1,
  checkpointSequence = 0,
  nowMs = Date.now(),
} = {}) {
  if (!isLangGraphShadowEnabled(env)) return disabledResult();

  const foundation = createLangGraphShadowFoundation({ env, pool });
  const normalizedObjective = normalizeObjective(objective);
  const normalizedTasks = Object.freeze((Array.isArray(tasks) ? tasks : []).map(normalizeTask));
  const normalizedResources = Object.freeze((Array.isArray(resources) ? resources : []).map(normalizeResource));

  const planDecision = planDelta
    ? governPlanDelta(planDelta, {
        expectedObjectiveId: normalizedObjective.id,
        expectedSourceRevision: normalizedObjective.source_revision,
        activeResourceScopes: normalizedTasks
          .filter(task => task.assigned_resource)
          .map(task => task.resource_scope),
      })
    : null;

  const eventDecision = reconcileSchedulerEvent(event);
  // Shadow proposals must respect the authoritative objective-level hold.
  // P0 remains Owner/Vy-only even if an upstream task is incorrectly marked P1.
  const objectiveHeld = normalizedObjective.owner_gate !== null || normalizedObjective.priority === 'P0';
  const schedule = objectiveHeld
    ? Object.freeze({ dispatches: freezeArray([]), idle: true, reason: 'objective_owner_gate' })
    : eventDecision.reconcile
    ? workStealPlan({
        tasks: normalizedTasks,
        resources: normalizedResources,
        activeDispatchKeys,
        nowMs,
        maxDispatches,
      })
    : Object.freeze({ dispatches: freezeArray([]), idle: true, reason: 'event_does_not_require_reconcile' });

  const currentSignature = noProgressSignature({
    tasks: normalizedTasks,
    resources: normalizedResources,
  });
  const noProgress = noProgressGuard({
    previousSignature: previousNoProgressSignature,
    currentSignature,
    repeatCount: noProgressRepeatCount,
    maxRepeats: noProgressMaxRepeats,
  });

  const threadId = stableObjectiveThreadId(normalizedObjective.id);
  const runId = stableRunId({
    objective_id: normalizedObjective.id,
    source_revision: normalizedObjective.source_revision,
    plan_revision: String(planDelta?.planRevision ?? planDelta?.plan_revision ?? '0'),
  });
  const checkpoint = buildCheckpointMetadata({
    objective_id: normalizedObjective.id,
    run_id: runId,
    checkpoint_id: `cp-${String(checkpointSequence).padStart(6, '0')}`,
    sequence: checkpointSequence,
    source_revision: normalizedObjective.source_revision,
    created_at: new Date(nowMs).toISOString(),
  });

  const dispatches = Object.freeze(schedule.dispatches.map(dispatch => Object.freeze({
    ...dispatch,
    idempotencyKey: sideEffectIdempotencyKey({
      objective_id: normalizedObjective.id,
      task_id: dispatch.taskId,
      effect: `dispatch:${dispatch.resourceId}`,
      source_revision: normalizedObjective.source_revision,
    }),
  })));

  return Object.freeze({
    enabled: true,
    foundationReady: Boolean(foundation.checkpointer),
    objective: normalizedObjective,
    tasks: normalizedTasks,
    resources: normalizedResources,
    planDecision,
    eventDecision,
    schedule: Object.freeze({ ...schedule, dispatches }),
    noProgress: Object.freeze({ ...noProgress, currentSignature }),
    threadId,
    runId,
    checkpoint,
  });
}
