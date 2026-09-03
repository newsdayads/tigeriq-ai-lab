import { describe,expect,it } from 'vitest';
import { authorityForEmployee,canEmployeePerform } from '../apps/ai-gateway/src/employees.js';
import type { EmployeeDefinition } from '../apps/ai-gateway/src/core.js';

function employee(employeeId:string,role:EmployeeDefinition['role']):EmployeeDefinition{return {employeeId,role,enabled:true,requiredCapabilities:[]};}

describe('AI employee authority',()=>{
  it('delegates engineering permissions to packages/agents',()=>{
    const coder=employee('coder-01','coder');
    const reviewer=employee('reviewer-01','reviewer');
    const judge=employee('judge-01','judge');
    expect(authorityForEmployee(coder).engineeringRole).toBe('coder');
    expect(canEmployeePerform(coder,'write-code')).toBe(true);
    expect(canEmployeePerform(coder,'review')).toBe(false);
    expect(canEmployeePerform(reviewer,'review')).toBe(true);
    expect(canEmployeePerform(reviewer,'write-code')).toBe(false);
    expect(canEmployeePerform(judge,'judge')).toBe(true);
  });

  it('gives non-engineering workforce personas no implicit engineering authority',()=>{
    const chief=employee('chief-01','chief');
    const researcher=employee('research-01','researcher');
    expect(authorityForEmployee(chief).policy).toBeUndefined();
    expect(canEmployeePerform(chief,'merge-main')).toBe(false);
    expect(canEmployeePerform(researcher,'read-production-secrets')).toBe(false);
  });

  it('never grants MAIN merge or production-secret authority through employee mapping',()=>{
    const roles:EmployeeDefinition['role'][]=['architect','coder','tester','reviewer','judge','chief','researcher','operator'];
    for(const role of roles){
      const row=employee(`emp-${role}`,role);
      expect(canEmployeePerform(row,'merge-main')).toBe(false);
      expect(canEmployeePerform(row,'read-production-secrets')).toBe(false);
    }
  });
});
