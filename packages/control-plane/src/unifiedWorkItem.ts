import { getObjective, getJobs, getEvents } from './dbHelpers';

export interface UnifiedWorkItem {
  workItemId: string;
  sourceRef: string;
  kind: string;
  assignedExecutor: string | null;
  stage: string;
  priority: number;
  lease: any;
  blockers: string[];
  evidenceRefs: string[];
  nextAction: string | null;
}

export function projectWorkItem(objectiveId: string): UnifiedWorkItem {
  const objective = getObjective(objectiveId);
  const jobs = getJobs(objectiveId);
  const events = getEvents(objectiveId);

  return {
    workItemId: objective.id,
    sourceRef: objective.sourceRef,
    kind: objective.kind,
    assignedExecutor: objective.assignedExecutor ?? null,
    stage: objective.stage,
    priority: objective.priority ?? 0,
    lease: objective.lease ?? null,
    blockers: events.filter((e) => e.status === 'blocker').map((e) => e.message),
    evidenceRefs: jobs.map((j) => j.evidenceRef),
    nextAction: objective.nextAction ?? null,
  };
}
  const objective = getObjective(objectiveId);
  const jobs = getJobs(objectiveId);
  const events = getEvents(objectiveId);

  return {
    workItemId: objective.id,
    sourceRef: objective.sourceRef,
    kind: objective.kind,
    assignedExecutor: objective.assignedExecutor ?? null,
    stage: objective.stage,
    priority: objective.priority ?? 0,
    lease: objective.lease,
    blockers: events.filter((e) => e.status === 'blocker').map((e) => e.message),
    evidenceRefs: jobs.map((j) => j.evidenceRef),
    nextAction: objective.nextAction ?? null,
  };
}
