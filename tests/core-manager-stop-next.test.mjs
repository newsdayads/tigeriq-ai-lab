import { describe,expect,it } from 'vitest';
import {managerIdleStepStopPlan} from '../apps/tigeriq-core/manager-cycle-policy.mjs';
import {managerJobMaterializationDecision} from '../apps/tigeriq-core/manager-job-policy.mjs';

describe('Owner-scoped Core bounded terminal and auto-next policy',()=>{
  it('allows one new decision before the two-decision no-progress stop',()=>{
    expect(managerIdleStepStopPlan({consecutiveNoProgressDecisions:1,activeChildren:0}).action).toBe('continue');
  });
  it('does not strand or pre-empt a live existing child when the limit is reached',()=>{
    expect(managerIdleStepStopPlan({consecutiveNoProgressDecisions:2,activeChildren:1}))
      .toMatchObject({action:'wait',reason:'await_existing_child_receipt'});
  });
  it('stops a jobless phase after two decisions and lets another scope be selected',()=>{
    expect(managerIdleStepStopPlan({consecutiveNoProgressDecisions:2,activeChildren:0}))
      .toMatchObject({action:'block',reason:'no_progress_decision_budget_exhausted',limit:2});
  });
  it('never allows a greater retry limit to bypass the global cap',()=>{
    expect(managerIdleStepStopPlan({consecutiveNoProgressDecisions:2,activeChildren:0,limit:999}).action).toBe('block');
  });
  it('does not mint another random UUID for the same failed logical job',()=>{
    expect(managerJobMaterializationDecision('failed'))
      .toMatchObject({action:'block',reason:'previous_failed_terminal_no_duplicate_job'});
    expect(managerJobMaterializationDecision('done').action).toBe('dedupe');
    expect(managerJobMaterializationDecision('queued').action).toBe('dedupe');
    expect(managerJobMaterializationDecision('').action).toBe('create');
  });
});