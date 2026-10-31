import { describe,expect,it } from 'vitest';
import {managerIdleStepStopPlan} from '../apps/tigeriq-core/manager-cycle-policy.mjs';
import {FAILED_LOGICAL_JOB_BLOCK_SUMMARY,MANAGER_NO_PROGRESS_BLOCK_SUMMARY,failedCampaignRuntimeRearmDecision,managerJobMaterializationDecision,providerPromptCompactionRecoveryEligible} from '../apps/tigeriq-core/manager-job-policy.mjs';
import {campaignPriorEvidenceContext,repairCampaignReviewPrompt} from '../apps/tigeriq-core/campaign-runner.mjs';
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
      .toEqual({action:'requeue',reason:'runtime_source_newer_than_failed_campaign_job',nextMaxAttempts:2});
    expect(failedCampaignRuntimeRearmDecision({...base,runtimeUpdatedAt:'2026-10-30T06:32:42Z'}).action).toBe('keep');
    expect(failedCampaignRuntimeRearmDecision({...base,attempts:2}).reason).toBe('retry_budget_exhausted');
    expect(failedCampaignRuntimeRearmDecision({...base,routingProfile:'AUTO'}).reason).toBe('not_local_campaign');
    expect(failedCampaignRuntimeRearmDecision({...base,objectiveSummary:MANAGER_NO_PROGRESS_BLOCK_SUMMARY}).action).toBe('requeue');
    expect(failedCampaignRuntimeRearmDecision({...base,objectiveSummary:'other'}).reason).toBe('not_failed_campaign_rearm_guard');
    const exhausted={...base,attempts:3,maxAttempts:3,runtimeUpdatedAt:'2026-10-30T07:00:00Z'};
    expect(failedCampaignRuntimeRearmDecision({...exhausted,promptRepairEligible:true}))
      .toEqual({action:'requeue_prompt_repair',reason:'runtime_source_newer_with_prompt_repair_credit',nextMaxAttempts:4});
    expect(failedCampaignRuntimeRearmDecision({...exhausted,promptRepairEligible:false}).reason).toBe('retry_budget_exhausted');
    expect(failedCampaignRuntimeRearmDecision({...exhausted,maxAttempts:4,attempts:4,promptRepairEligible:true}).reason).toBe('retry_budget_exhausted');
    expect(failedCampaignRuntimeRearmDecision({...exhausted,maxAttempts:4,attempts:4,promptRepairEligible:true,promptRepairCap:5}))
      .toEqual({action:'requeue_prompt_repair',reason:'runtime_source_newer_with_prompt_repair_credit',nextMaxAttempts:5});
    expect(failedCampaignRuntimeRearmDecision({...exhausted,maxAttempts:5,attempts:5,promptRepairEligible:true,promptRepairCap:5}).reason).toBe('retry_budget_exhausted');
    expect(failedCampaignRuntimeRearmDecision({...exhausted,maxAttempts:5,attempts:5,promptRepairEligible:true,promptRepairCap:6}))
      .toEqual({action:'requeue_prompt_repair',reason:'runtime_source_newer_with_prompt_repair_credit',nextMaxAttempts:6});
    expect(failedCampaignRuntimeRearmDecision({...exhausted,maxAttempts:6,attempts:6,promptRepairEligible:true,promptRepairCap:6}).reason).toBe('retry_budget_exhausted');
  });
  it('grants the 5-to-6 NV09 recovery credit only from the exact same-job failure receipt',()=>{
    const exact={
      capability:'review',
      phaseIndex:1,
      maxAttempts:5,
      compactRepairReason:'compact_contract_already_present',
      failure:{failures:[{kind:'job_contract',message:'NV09_COMPILED_PROMPT_BUDGET_EXCEEDED'}]},
    };
    expect(providerPromptCompactionRecoveryEligible(exact)).toBe(true);
    expect(providerPromptCompactionRecoveryEligible({...exact,maxAttempts:4})).toBe(false);
    expect(providerPromptCompactionRecoveryEligible({...exact,capability:'reasoning'})).toBe(false);
    expect(providerPromptCompactionRecoveryEligible({...exact,phaseIndex:0})).toBe(false);
    expect(providerPromptCompactionRecoveryEligible({...exact,compactRepairReason:'compact_hint_added'})).toBe(false);
    expect(providerPromptCompactionRecoveryEligible({...exact,failure:{failures:[{kind:'job_contract',message:'OTHER'}]}})).toBe(false);
    expect(providerPromptCompactionRecoveryEligible({...exact,failure:{failures:[{kind:'outage',message:'NV09_COMPILED_PROMPT_BUDGET_EXCEEDED'}]}})).toBe(false);
    expect(providerPromptCompactionRecoveryEligible({...exact,failure:{message:'NV09_COMPILED_PROMPT_BUDGET_EXCEEDED'}})).toBe(false);
  });
  it('hands the immediately previous verified campaign evidence to the next phase without unbounded payloads',()=>{
    const text=campaignPriorEvidenceContext({
      currentPhase:1,
      checkpoints:[{phaseIndex:0,phaseNumber:1,phaseTitle:'Build',summary:'Verified by JOB-EVID-1',jobId:'JOB-EVID-1',employeeId:'NV10',resourceId:'res:nv10',completedAt:'2026-10-30T06:30:00Z'}],
      jobs:[
        {id:'JOB-EVID-1',title:'Phase 1 verification',phase_index:0,kind:'compiled_campaign',status:'done',employee_id:'NV10',resource_id:'res:nv10',provider:'ollama',completed_at:'2026-10-30T06:30:00Z',result:{text:'{"schema":"EXECUTION_RESULT_V1","status":"complete","evidence":[{"id":"e1","value":"phase1 proof"}]}',executionGate:{pass:true,code:'EXECUTION_ACCEPTED',evidenceIds:['e1']}}},
        {id:'JOB-WORK-1',title:'Implement phase 1',phase_index:0,kind:'compiled_ai',status:'done',employee_id:'NV10',resource_id:'res:nv10',provider:'ollama',completed_at:'2026-10-30T06:29:00Z',result:{text:'observable phase 1 result'}},
        {id:'JOB-FUTURE',title:'Wrong phase',phase_index:1,kind:'compiled_ai',status:'done',result:{text:'must not leak'}},
      ],
    });
    expect(text).toContain('PRIOR_CAMPAIGN_HANDOFF_V1');
    expect(text).toContain('JOB-EVID-1');
    expect(text).toContain('phase1 proof');
    expect(text).toContain('EXECUTION_ACCEPTED');
    expect(text).not.toContain('JOB-FUTURE');
    expect(text.length).toBeLessThanOrEqual(2600);
  });
  it('does not invent prior campaign evidence on phase zero',()=>{
    expect(campaignPriorEvidenceContext({currentPhase:0,checkpoints:[],jobs:[]})).toBe('');
  });
  it('repairs a stale review prompt once without replacing its original compiled packet',()=>{
    const original='PACKET_JSON: {"task_id":"JOB-1"}\nOUTPUT REQUIREMENT: JSON only';
    const context='PRIOR_CAMPAIGN_HANDOFF_V1 {"checkpoint":{"jobId":"JOB-EVID-1"}}';
    const repaired=repairCampaignReviewPrompt(original,context);
    expect(repaired.changed).toBe(true);
    expect(repaired.prompt).toContain(original);
    expect(repaired.prompt).toContain('AUTHORIZED PRIOR CAMPAIGN HANDOFF:');
    expect(repaired.prompt).toContain('JOB-EVID-1');
    const second=repairCampaignReviewPrompt(repaired.prompt,context);
    expect(second.changed).toBe(false);
    expect(second.reason).toBe('prior_context_already_present');
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
