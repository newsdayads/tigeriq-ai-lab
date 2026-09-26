export type AgentRole = 'architect' | 'coder' | 'reviewer' | 'qa' | 'judge' | 'release-manager';

export interface AgentPolicy {
  role: AgentRole;
  canWriteCode: boolean;
  canReview: boolean;
  canJudge: boolean;
  canMergeMain: boolean;
  canReadProductionSecrets: boolean;
}

export const agentPolicies: Record<AgentRole, AgentPolicy> = {
  architect: { role: 'architect', canWriteCode: false, canReview: false, canJudge: false, canMergeMain: false, canReadProductionSecrets: false },
  coder: { role: 'coder', canWriteCode: true, canReview: false, canJudge: false, canMergeMain: false, canReadProductionSecrets: false },
  reviewer: { role: 'reviewer', canWriteCode: false, canReview: true, canJudge: false, canMergeMain: false, canReadProductionSecrets: false },
  qa: { role: 'qa', canWriteCode: false, canReview: false, canJudge: false, canMergeMain: false, canReadProductionSecrets: false },
  judge: { role: 'judge', canWriteCode: false, canReview: false, canJudge: true, canMergeMain: false, canReadProductionSecrets: false },
  'release-manager': { role: 'release-manager', canWriteCode: false, canReview: false, canJudge: false, canMergeMain: false, canReadProductionSecrets: false }
};

export function assertIndependentRoles(coder: AgentRole, reviewer: AgentRole, judge: AgentRole): boolean {
  return coder !== reviewer && coder !== judge && reviewer !== judge;
}
