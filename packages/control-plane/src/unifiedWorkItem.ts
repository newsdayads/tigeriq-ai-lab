import { getObjective, getJob, getEventsForObjective } from './dbHelpers.js';

export interface UnifiedWorkItem {
  workItemId: string;
  sourceRef?: string;
  kind: string;
  assignedExecutor?: string;
  stage: string;
  priority: number;
  lease?: string;
  blockers: string[];
  evidenceRefs: string[];
  nextAction?: string;
}

export function projectWorkItem(objectiveId: string): UnifiedWorkItem {
  const objective = getObjective(objectiveId);
  const job = getJob(objectiveId);
  const events = getEventsForObjective(objectiveId);

  const kind = objective?.kind ?? job?.kind ?? 'general';
  const assignedExecutor = objective?.assignedExecutor ?? job?.assignedExecutor;
  const telemetry = objective?.telemetry ?? job?.telemetry ?? {};
  const priority = objective?.priority ?? job?.priority ?? 100;
  const lease = objective?.lease ?? job?.lease;
  const blockers = objective?.blockers ?? job?.blockers ?? [];
  const evidenceRefs = objective?.evidenceRefs ?? job?.evidenceRefs ?? [];
  const nextAction = objective?.nextAction ?? job?.nextAction;

  let stage = objective?.stage ?? job?.stage ?? 'QUEUED';

  for (const event of events) {
    if (event.stage) {
      stage = event.stage;
    }
  }

  if (stage === 'QUEUED' && (kind === 'coding')) {
    stage = 'coding-lane';
  }

  return {
    workItemId: objectiveId,
    sourceRef: objective?.sourceRef ?? job?.sourceRef,
    kind,
    assignedExecutor,
    stage,
    priority,
    lease,
    blockers,
    evidenceRefs,
    nextAction,
  };
}
