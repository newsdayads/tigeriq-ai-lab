import { getObjective, getJobsForObjective, getEventsForObjective } from './dbHelpers.js';

export interface UnifiedWorkItem {
  workItemId: string;
  sourceRef: string;
  kind: string;
  assignedExecutor?: string;
  stage: string;
  priority: number;
  lease?: {
    holder: string;
    expiresAt: string;
  };
  blockers: string[];
  evidenceRefs: string[];
  nextAction?: string;
}

export function projectWorkItem(objectiveId: string): UnifiedWorkItem {
  const objective = getObjective(objectiveId);
  if (!objective) {
    throw new Error(`Objective ${objectiveId} not found`);
  }

  const jobs = getJobsForObjective(objectiveId);
  const events = getEventsForObjective(objectiveId);

  const assignedExecutor = jobs.find((j) => j.executor)?.executor;
  const lease = jobs.find((j) => j.lease)?.lease;

  let stage = objective.status;
  if (jobs.length > 0) {
    const activeJob = jobs.find((j) => j.status === 'running' || j.status === 'pending');
    if (activeJob) {
      stage = activeJob.status;
    }
  }

  const blockers: string[] = [];
  for (const event of events) {
    if (event.type === 'blocker' || event.severity === 'error') {
      blockers.push(event.message || event.id);
    }
  }

  const evidenceRefs: string[] = [];
  for (const job of jobs) {
    if (job.evidenceIds) {
      evidenceRefs.push(...job.evidenceIds);
    }
  }

  const nextAction = jobs.find((j) => j.nextAction)?.nextAction;

  return {
    workItemId: objective.id,
    sourceRef: objective.sourceRef || `objective:${objective.id}`,
    kind: objective.kind || 'tigeriq_objective',
    assignedExecutor,
    stage,
    priority: objective.priority ?? 0,
    lease,
    blockers,
    evidenceRefs,
    nextAction,
  };
}
