import {describe,expect,it} from 'vitest';
import {staleLeaseRecoveryPlan} from '../apps/tigeriq-core/job-recovery-policy.mjs';

describe('Core stale lease recovery policy',()=>{
  it('requeues only while a retry budget remains',()=>{
    expect(staleLeaseRecoveryPlan({attempts:0,maxAttempts:2})).toEqual({
      currentAttempts:0,maxAttempts:2,nextAttempts:1,exhausted:false,
    });
  });

  it('terminalizes when stale recovery reaches the retry boundary',()=>{
    expect(staleLeaseRecoveryPlan({attempts:1,maxAttempts:2})).toEqual({
      currentAttempts:1,maxAttempts:2,nextAttempts:2,exhausted:true,
    });
    expect(staleLeaseRecoveryPlan({attempts:2,maxAttempts:2}).exhausted).toBe(true);
  });
});
