import { agentPolicies,type AgentPolicy,type AgentRole } from '../../../packages/agents/src/index.js';
import type { EmployeeDefinition,EmployeeRole } from './core.js';

const engineeringRoleMap:Partial<Record<EmployeeRole,AgentRole>>={
  architect:'architect',
  coder:'coder',
  tester:'qa',
  reviewer:'reviewer',
  judge:'judge'
};

export interface EmployeeAuthority {
  employeeId:string;
  workforceRole:EmployeeRole;
  engineeringRole?:AgentRole;
  policy?:AgentPolicy;
}

/** Workforce personas never invent permissions. Engineering authority is delegated to packages/agents only. */
export function authorityForEmployee(employee:EmployeeDefinition):EmployeeAuthority{
  const engineeringRole=engineeringRoleMap[employee.role];
  return {
    employeeId:employee.employeeId,
    workforceRole:employee.role,
    engineeringRole,
    policy:engineeringRole?agentPolicies[engineeringRole]:undefined
  };
}

export function canEmployeePerform(employee:EmployeeDefinition,action:'write-code'|'review'|'judge'|'merge-main'|'read-production-secrets'):boolean{
  const policy=authorityForEmployee(employee).policy;
  if(!policy)return false;
  if(action==='write-code')return policy.canWriteCode;
  if(action==='review')return policy.canReview;
  if(action==='judge')return policy.canJudge;
  if(action==='merge-main')return policy.canMergeMain;
  return policy.canReadProductionSecrets;
}
