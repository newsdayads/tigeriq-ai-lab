import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {detectIdleWithBacklog,routingFault} from '../apps/tigeriq-core/github-backlog-policy.mjs';
import {effectiveCoreJobRoutingProfile,mayWaitAfterLocalFailure} from '../apps/tigeriq-core/objective-local-routing.mjs';

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

// Regression: Core forces github_api_autowork to NV10/LOCAL during execution;
// the resource-wait decision must not quietly revert to persisted AUTO.
describe('GitHub local auto-work resource wait consistency',()=>{
  it('uses LOCAL for temporary GitHub API worker unavailability and preserves other profiles',()=>{
    const local=effectiveCoreJobRoutingProfile({kind:'github_api_autowork',routing_profile:'AUTO'});
    expect(local).toBe('LOCAL');
    expect(effectiveCoreJobRoutingProfile({kind:'github_api_autowork'})).toBe('LOCAL');
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
