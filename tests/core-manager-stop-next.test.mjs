import { describe,expect,it } from 'vitest';
import {managerIdleStepStopPlan} from '../apps/tigeriq-core/manager-cycle-policy.mjs';
import {FAILED_LOGICAL_JOB_BLOCK_SUMMARY,MANAGER_NO_PROGRESS_BLOCK_SUMMARY,failedCampaignRuntimeRearmDecision,managerJobMaterializationDecision} from '../apps/tigeriq-core/manager-job-policy.mjs';
import {apiDoctorAutoworkPriority} from '../apps/tigeriq-core/api-doctor.mjs';

describe('Owner-scoped Core bounded terminal and auto-next policy',()=>{
  it('allows one new decision before the two-decision no-progress stop',()=>{
    expect(managerIdleStepStopPlan({consecutiveNoProgressDecisions:1,activeChildren:0}).action).toBe('continue');
  });
  it('does not strand or pre-empt a live existing child when the limit is reached',()=>{
    expect(managerIdleStepStopPlan({consecutiveNoProgressDecisions:2,activeChildren:1}))
      .toMatchObject({action:'wait',reason:'await_existing_child_receipt'});
  });
  it('parks a revision-scoped GitHub objective with a real completed child without asserting acceptance',()=>{
    expect(managerIdleStepStopPlan({consecutiveNoProgressDecisions:2,activeChildren:0,completedChildren:1,source:'github',sourceRevision:'rev-abc'}))
      .toMatchObject({action:'park',reason:'await_verified_child_acceptance'});
    for(const input of [{source:'api',sourceRevision:'rev-abc'},{source:'github',sourceRevision:''}]){
      expect(managerIdleStepStopPlan({consecutiveNoProgressDecisions:2,activeChildren:0,completedChildren:1,...input}).action).toBe('block');
    }
    expect(managerIdleStepStopPlan({consecutiveNoProgressDecisions:2,activeChildren:1,completedChildren:1,source:'github',sourceRevision:'rev-abc'}).action).toBe('wait');
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
  it('requeues the same failed LOCAL campaign job only after a newer runtime source and within budget',()=>{
    const base={
      objectiveStatus:'blocked',
      objectiveSummary:FAILED_LOGICAL_JOB_BLOCK_SUMMARY,
      jobStatus:'failed',
      attempts:1,
      maxAttempts:2,
      jobCompletedAt:'2026-10-30T06:32:42Z',
      runtimeUpdatedAt:'2026-10-30T06:52:18Z',
      hasCampaign:true,
      routingProfile:'LOCAL',
    };
    expect(failedCampaignRuntimeRearmDecision(base))
      .toEqual({action:'requeue',reason:'runtime_source_newer_than_failed_campaign_job'});
    expect(failedCampaignRuntimeRearmDecision({...base,objectiveSummary:MANAGER_NO_PROGRESS_BLOCK_SUMMARY}))
      .toEqual({action:'requeue',reason:'runtime_source_newer_than_failed_campaign_job'});
    expect(failedCampaignRuntimeRearmDecision({...base,runtimeUpdatedAt:'2026-10-30T06:32:42Z'}).action).toBe('keep');
    expect(failedCampaignRuntimeRearmDecision({...base,attempts:2}).reason).toBe('retry_budget_exhausted');
    expect(failedCampaignRuntimeRearmDecision({...base,routingProfile:'AUTO'}).reason).toBe('not_local_campaign');
    expect(failedCampaignRuntimeRearmDecision({...base,objectiveSummary:'other'}).reason).toBe('not_failed_logical_job_guard');
  });
});

describe('NV10 optional diagnosis must yield to real accepted GitHub work',()=>{
  it('defers recurring API Doctor work while any dispatchable local work exists',()=>{
    expect(apiDoctorAutoworkPriority(1)).toEqual({defer:true,reason:'ACTIVE_GITHUB_LOCAL_WORK_HAS_PRIORITY'});
    expect(apiDoctorAutoworkPriority(3).defer).toBe(true);
  });
  it('allows diagnosis when no ready local Owner work is waiting',()=>{
    expect(apiDoctorAutoworkPriority(0)).toEqual({defer:false,reason:'NO_ACTIVE_GITHUB_LOCAL_WORK'});
  });
  it('does not suppress diagnostics based on invalid counters',()=>{
    for(const n of [-1,NaN,Infinity,'invalid',1.5]){
      expect(apiDoctorAutoworkPriority(n).defer).toBe(false);
    }
  });
});
