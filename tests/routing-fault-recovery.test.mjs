import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {detectIdleWithBacklog,routingFault} from '../apps/tigeriq-core/github-backlog-policy.mjs';

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
