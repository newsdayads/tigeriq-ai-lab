export interface MockObjective {
  workItemId: string;
  sourceRef?: string;
  kind?: string;
  assignedExecutor?: string;
  stage?: string;
  priority?: number;
  lease?: string;
  blockers?: string[];
  evidenceRefs?: string[];
  nextAction?: string;
}

export interface MockJob {
  workItemId: string;
  kind?: string;
  assignedExecutor?: string;
  stage?: string;
  priority?: number;
  lease?: string;
  blockers?: string[];
  evidenceRefs?: string[];
  sourceRef?: string;
  nextAction?: string;
}

export interface MockEvent {
  id: string;
  objectiveId: string;
  stage?: string;
  timestamp: string;
}

export const objectivesStore = new Map<string, MockObjective>();
export const jobsStore = new Map<string, MockJob>();
export const eventsStore = new Map<string, MockEvent[]>();
export const agentStatusStore = new Map<string, { status: string; timestamp: string; telemetry?: Record<string, unknown> }>();

export function getObjective(id: string): MockObjective | undefined {
  return objectivesStore.get(id);
}

export function getJob(id: string): MockJob | undefined {
  return jobsStore.get(id);
}

export function getEventsForObjective(id: string): MockEvent[] {
  return eventsStore.get(id) ?? [];
}

export function setAgentStatus(agentId: string, status: string, telemetry?: Record<string, unknown>) {
  agentStatusStore.set(agentId, { status, timestamp: new Date().toISOString(), telemetry });
}

export function getAgentStatus(agentId: string) {
  return agentStatusStore.get(agentId);
}

export function getAgentStatuses() {
  return Array.from(agentStatusStore.entries());
}
