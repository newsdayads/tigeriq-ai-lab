import {describe,expect,it} from 'vitest';
import {assertExecutionPlaneMutationPaths,controlPlaneRepairContext,isProtectedControlPlanePath,protectedControlPlanePaths} from '../apps/shared/control-plane-lock.mjs';
import {parseCodingIssue} from '../apps/tigeriq-core/github-coding-intake.mjs';
import {validateManagerJobPaths} from '../apps/tigeriq-coding-lane/coding-lane.mjs';

const SAFE=`TIGERIQ_EXECUTABLE=true
OWNER_POLICY=AUTO
AUTONOMOUS_CODE=true
ZERO_COST=true
NO_PC01_SHELL=true
NO_PAID_COST=true
NO_CREDENTIAL_CHANGE=true
NO_DESTRUCTIVE=true
NO_PRODUCTION_RELEASE=true
NO_BROWSER_AUTH=true
NO_DIRECT_MAIN=true
PRIORITY=P0`;

function issue(body){
  return {number:1322,title:'guard probe',body,state:'open',html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/1322'};
}

describe('Control Plane maintenance lock v33',()=>{
  it('classifies protected Control Plane paths and leaves execution-plane paths available',()=>{
    for(const path of [
      'apps/tigeriq-core/core.mjs',
      'apps/tigeriq-coding-lane/coding-lane.mjs',
      'apps/chrome-controller/src/server.ts',
      'apps/worker-utility/Program.cs',
      '.github/workflows/ci.yml',
      'scripts/tigeriq-core/run-core.ps1',
      'apps/shared/control-plane-lock.mjs',
      'docs/EXECUTION_BOUNDARY.md',
    ]) expect(isProtectedControlPlanePath(path)).toBe(true);
    expect(isProtectedControlPlanePath('apps/dashboard/server.ts')).toBe(false);
    expect(protectedControlPlanePaths(['apps/dashboard/server.ts','apps/tigeriq-core/core.mjs'])).toEqual(['apps/tigeriq-core/core.mjs']);
  });

  it('fails closed with DENY_CONTROL_PLANE_MUTATION for protected mutations',()=>{
    expect(()=>assertExecutionPlaneMutationPaths(['apps/tigeriq-core/core.mjs'])).toThrow(/DENY_CONTROL_PLANE_MUTATION/);
    expect(()=>validateManagerJobPaths({status:'continue',job:{paths:['apps/chrome-controller/src/server.ts']}},[])).toThrow(/DENY_CONTROL_PLANE_MUTATION/);
    expect(validateManagerJobPaths({status:'continue',job:{paths:['apps/dashboard/server.ts']}},[])).toEqual(['apps/dashboard/server.ts']);
  });

  it('prevents ordinary AUTO GitHub intake from claiming protected Control Plane scope',()=>{
    const protectedIssue=issue(`${SAFE}
RESOURCE_SCOPE=CORE_MUTATION
ALLOW_PATH_PREFIX=apps/tigeriq-core/core.mjs,tests/`);
    expect(parseCodingIssue(protectedIssue)).toBeNull();

    const executionIssue=issue(`${SAFE}
RESOURCE_SCOPE=DASHBOARD
ALLOW_PATH_PREFIX=apps/dashboard/,tests/`);
    expect(parseCodingIssue(executionIssue)?.number).toBe(1322);
  });

  it('keeps ordinary AUTO protected mutation blocked but allows explicit NV02 owner-proxy independent repair',()=>{
    const ordinary=issue(`${SAFE}\nRESOURCE_SCOPE=CORE_MUTATION\nALLOW_PATH_PREFIX=apps/tigeriq-core/core.mjs,tests/`);
    expect(parseCodingIssue(ordinary)).toBeNull();
    expect(()=>assertExecutionPlaneMutationPaths(['apps/tigeriq-core/core.mjs'])).toThrow(/DENY_CONTROL_PLANE_MUTATION/);

    const delegated=issue(`${SAFE}\nOWNER_PROXY=NV02\nAUTO_CONTROL_REPAIR=true\nINDEPENDENT_REPAIR_REQUIRED=true\nRESOURCE_SCOPE=CORE_MUTATION\nALLOW_PATH_PREFIX=apps/tigeriq-core/core.mjs,tests/`);
    const auth=controlPlaneRepairContext(delegated.body);
    expect(auth.allowProtectedControlPlane).toBe(true);
    expect(parseCodingIssue(delegated)?.number).toBe(1322);
    expect(assertExecutionPlaneMutationPaths(['apps/tigeriq-core/core.mjs'],auth)).toBe(true);
    expect(validateManagerJobPaths({status:'continue',job:{paths:['apps/tigeriq-core/core.mjs']}},[],auth)).toEqual(['apps/tigeriq-core/core.mjs']);
  });
});
