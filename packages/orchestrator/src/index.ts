import type { AgentRole } from '../../agents/src/index.js';

export interface Assignment {
  workOrderId: string;
  role: AgentRole;
  agentId: string;
}

export function validateAssignments(assignments: Assignment[]): string[] {
  const errors: string[] = [];
  const byRole = new Map(assignments.map((a) => [a.role, a.agentId]));
  const coder = byRole.get('coder');
  const reviewer = byRole.get('reviewer');
  const judge = byRole.get('judge');
  if (!coder || !reviewer || !judge) errors.push('coder, reviewer and judge assignments are required');
  if (coder && reviewer && coder === reviewer) errors.push('coder and reviewer must be independent');
  if (coder && judge && coder === judge) errors.push('coder and judge must be independent');
  if (reviewer && judge && reviewer === judge) errors.push('reviewer and judge must be independent');
  return errors;
}
