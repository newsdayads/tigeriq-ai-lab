import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {detectIdleWithBacklog,routingFault} from '../apps/tigeriq-core/github-backlog-policy.mjs';
import {effectiveCoreJobRoutingProfile,mayWaitAfterLocalFailure,githubAutoworkEmployeeAllowlist,githubAutoworkZeroCostResource} from '../apps/tigeriq-core/objective-local-routing.mjs';

describe('Core routing fault recovery policy',()=>{
  it('flags only eligible backlog with idle matching capacity and no active work',()=>{
    expect(routingFault({eligibleBacklogCount:1,activeWorkCount:0,eligibleIdleWorkers:1})).toEqual({
      fault:true,eligibleBacklogCount:1,activeWorkCount:0,eligibleIdleWorkers:1,code:'ROUTING_FAULT'
    });
    expect(routingFault({eligibleBacklogCount:0,activeWorkCount:0,eligibleIdleWorkers:3}).fault).toBe(false);
    expect(routingFault({eligibleBacklogCount:2,activeWorkCount:1,eligibleIdleWorkers:3}).fault).toBe(false);
    expect(routingFault({eligibleBacklogCount:2,activeWorkCount:0,eligibleIdleWorkers:0}).fault).toBe(false);
  });

  it('does not report idle backlog for ineligible queued residue',()=>{
    expect(detectIdleWithBacklog(0,0)).toBe(false);
    expect(detectIdleWithBacklog(0,1)).toBe(true);
  });

  it('does not let manager evaluation block queued-job dispatch',()=>{
    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    expect(core).toContain('managerTickRunning=false');
    expect(core).toMatch(/void managerTick\(\)\.catch\(/);
    expect(core).not.toMatch(/await managerTick\(\)/);
  });
});

// Explicit LOCAL jobs remain pinned; unspecified GitHub coordination can
// fail over among already-authorized zero-cost API resources.
describe('GitHub auto-work resource wait consistency',()=>{
  it('retains explicit LOCAL while defaulting safe coordination to AUTO',()=>{
    const local=effectiveCoreJobRoutingProfile({kind:'github_api_autowork',routing_profile:'LOCAL'});
    expect(local).toBe('LOCAL');
    expect(effectiveCoreJobRoutingProfile({kind:'github_api_autowork'})).toBe('AUTO');
    expect(effectiveCoreJobRoutingProfile({kind:'github_api_autowork',routing_profile:'AUTO'})).toBe('AUTO');
    expect(effectiveCoreJobRoutingProfile({kind:'github_review',routing_profile:'AUTO'})).toBe('AUTO');
    expect(effectiveCoreJobRoutingProfile({kind:'compiled_general',routing_profile:'QUALITY'})).toBe('QUALITY');
    expect(mayWaitAfterLocalFailure({profile:local,message:'NO_AI_RESOURCE_AVAILABLE',failures:[{kind:'timeout'}],configuredLocalCount:1})).toBe(true);
    expect(mayWaitAfterLocalFailure({profile:local,message:'NO_AI_RESOURCE_AVAILABLE',failures:[{kind:'auth'}],configuredLocalCount:1})).toBe(false);
    expect(mayWaitAfterLocalFailure({profile:local,message:'NO_AI_RESOURCE_AVAILABLE',failures:[],configuredLocalCount:0})).toBe(false);
  });
  it('wires the effective profile to both dispatch and bounded no-resource handling',()=>{
    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    expect(core).toContain('const effectiveWaitProfile=effectiveCoreJobRoutingProfile(j);');
    expect(core).toContain('busyCapableResourceCount(j.capability,effectiveWaitProfile)');
    expect(core).toContain('mayWaitAfterLocalFailure({profile:effectiveWaitProfile,');
    expect(core).toContain('taskKind:j.kind||\'ai\',profile:effectiveCoreJobRoutingProfile(j),reviewerResourceIds,');
  });
});


describe('NV17 source-authorized zero-cost GitHub auto-work routing',()=>{
  const defaults=['NV10','NV11','NV12'];
  const base={kind:'github_api_autowork',objective_metadata:{
    targetWorker:'NV17',ownerDirect:true,admissionMode:'SAFE_P1_P5_POLICY'
  }};
  it('admits only the explicitly targeted NV17 under owner-direct safe P1-P5 policy',()=>{
    expect(githubAutoworkEmployeeAllowlist(base,defaults)).toEqual(['NV17']);
    expect(githubAutoworkEmployeeAllowlist({...base,objective_metadata:{...base.objective_metadata,targetWorker:'nv17'}},defaults)).toEqual(['NV17']);
  });
  it('keeps the existing NV10-NV12 default for other jobs and untrusted targets',()=>{
    expect(githubAutoworkEmployeeAllowlist({kind:'github_api_autowork'},defaults)).toEqual(defaults);
    expect(githubAutoworkEmployeeAllowlist({...base,objective_metadata:{...base.objective_metadata,ownerDirect:false}},defaults)).toEqual(defaults);
    expect(githubAutoworkEmployeeAllowlist({...base,objective_metadata:{...base.objective_metadata,admissionMode:'LEGACY_EXECUTION_FLAGS'}},defaults)).toEqual(defaults);
    expect(githubAutoworkEmployeeAllowlist({...base,objective_metadata:{...base.objective_metadata,targetWorker:'NV14'}},defaults)).toEqual(defaults);
    expect(githubAutoworkEmployeeAllowlist({...base,kind:'github_review'},defaults)).toEqual(defaults);
  });
  it('filters paid, missing-tier and unsupported resources before both claim and queue projection',()=>{
    expect(githubAutoworkZeroCostResource(base,{cost_tier:'FREE'})).toBe(true);
    expect(githubAutoworkZeroCostResource(base,{cost_tier:'LOCAL'})).toBe(true);
    expect(githubAutoworkZeroCostResource(base,{cost_tier:'PAID'})).toBe(false);
    expect(githubAutoworkZeroCostResource(base,{cost_tier:''})).toBe(false);
    expect(githubAutoworkZeroCostResource(base,{})).toBe(false);
    expect(githubAutoworkZeroCostResource({kind:'github_review'},{cost_tier:'PAID'})).toBe(true);
  });
  it('uses the same scoped allowlist and free-cost guard for dispatch and eligibility',()=>{
    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    expect(core).toContain("const employeeAllowlist=j.kind==='github_api_autowork'?githubAutoworkEmployeeAllowlist(j,CORE_AUTOWORK_EMPLOYEES):stabilityAllowlist;");
    expect(core).toContain("new Set(githubAutoworkEmployeeAllowlist(job,CORE_AUTOWORK_EMPLOYEES))");
    expect(core).toContain(".filter(x=>githubAutoworkZeroCostResource({kind:taskKind},x))");
    expect(core).toContain("if(!githubAutoworkZeroCostResource({kind:taskKind},resource))return false;");
    expect(core).toContain("preferredEmployeeId:j.objective_metadata?.targetWorker||null");
  });
});
