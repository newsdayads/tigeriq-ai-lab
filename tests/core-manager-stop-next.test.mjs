import { describe,expect,it } from 'vitest';
import {managerIdleStepStopPlan} from '../apps/tigeriq-core/manager-cycle-policy.mjs';
import {FAILED_LOGICAL_JOB_BLOCK_SUMMARY,MANAGER_NO_PROGRESS_BLOCK_SUMMARY,campaignPromptRepairRetryCap,failedCampaignRuntimeRearmDecision,managerJobMaterializationDecision,persistedPhaseZeroReviewRepairRecoveryEligible,phaseZeroReviewStrictAcceptanceRecoveryEligible,phaseZeroReviewHandoffTransportRecoveryEligible,providerPromptCompactionRecoveryEligible,providerPriorCampaignEvidenceRecoveryEligible} from '../apps/tigeriq-core/manager-job-policy.mjs';
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
  it('grants one 4-to-5 credit when a failed phase-zero review prompt gains trusted referenced receipts',()=>{
    const cap=campaignPromptRepairRetryCap({promptRepairChanged:true});
    expect(cap).toBe(5);
    expect(campaignPromptRepairRetryCap({compactRepairChanged:true})).toBe(5);
    expect(campaignPromptRepairRetryCap({providerPromptCompactionEligible:true})).toBe(6);
    expect(campaignPromptRepairRetryCap({providerPriorCampaignEvidenceEligible:true})).toBe(7);
    expect(campaignPromptRepairRetryCap()).toBe(4);
    expect(failedCampaignRuntimeRearmDecision({
      objectiveStatus:'blocked',
      objectiveSummary:MANAGER_NO_PROGRESS_BLOCK_SUMMARY,
      jobStatus:'failed',
      attempts:4,
      maxAttempts:4,
      jobCompletedAt:'2026-10-31T03:37:52Z',
      runtimeUpdatedAt:'2026-10-31T04:00:00Z',
      hasCampaign:true,
      routingProfile:'LOCAL',
      promptRepairEligible:true,
      promptRepairCap:cap,
    })).toEqual({
      action:'requeue_prompt_repair',
      reason:'runtime_source_newer_with_prompt_repair_credit',
      nextMaxAttempts:5,
    });
  });
  it('recovers exactly one persisted phase-zero trusted-handoff repair after restart',()=>{
    const exact={
      capability:'review',
      phaseIndex:0,
      maxAttempts:4,
      prompt:'x\n\nAUTHORIZED PRIOR CAMPAIGN HANDOFF:\nPRIOR_CAMPAIGN_HANDOFF_V1 {"schema":"TIGERIQ_REFERENCED_JOB_EVIDENCE_V1"}',
      failure:{failures:[{kind:'invalid_response',message:'EXECUTION_RESULT_BLOCKED'}]},
    };
    expect(persistedPhaseZeroReviewRepairRecoveryEligible(exact)).toBe(true);
    expect(persistedPhaseZeroReviewRepairRecoveryEligible({...exact,maxAttempts:5})).toBe(false);
    expect(persistedPhaseZeroReviewRepairRecoveryEligible({...exact,phaseIndex:1})).toBe(false);
    expect(persistedPhaseZeroReviewRepairRecoveryEligible({...exact,capability:'reasoning'})).toBe(false);
    expect(persistedPhaseZeroReviewRepairRecoveryEligible({...exact,prompt:'no trusted handoff'})).toBe(false);
    expect(persistedPhaseZeroReviewRepairRecoveryEligible({...exact,failure:{failures:[{kind:'outage',message:'EXECUTION_RESULT_BLOCKED'}]}})).toBe(false);
    const cap=campaignPromptRepairRetryCap({persistedPhaseZeroRepairEligible:true});
    expect(cap).toBe(5);
    expect(failedCampaignRuntimeRearmDecision({
      objectiveStatus:'blocked',
      objectiveSummary:MANAGER_NO_PROGRESS_BLOCK_SUMMARY,
      jobStatus:'failed',
      attempts:4,
      maxAttempts:4,
      jobCompletedAt:'2026-10-31T03:37:52Z',
      runtimeUpdatedAt:'2026-10-31T05:40:00Z',
      hasCampaign:true,
      routingProfile:'LOCAL',
      promptRepairEligible:true,
      promptRepairCap:cap,
    })).toEqual({
      action:'requeue_prompt_repair',
      reason:'runtime_source_newer_with_prompt_repair_credit',
      nextMaxAttempts:5,
    });
  });
  it('grants exactly one phase-zero 5-to-6 credit for the strict acceptance source fix',()=>{
    const exact={
      capability:'review',
      phaseIndex:0,
      maxAttempts:5,
      prompt:'x\n\nAUTHORIZED PRIOR CAMPAIGN HANDOFF:\nPRIOR_CAMPAIGN_HANDOFF_V1 {"schema":"TIGERIQ_REFERENCED_JOB_EVIDENCE_V1"}',
      failure:{failures:[{kind:'invalid_response',message:'EXECUTION_RESULT_BLOCKED'}]},
    };
    expect(phaseZeroReviewStrictAcceptanceRecoveryEligible(exact)).toBe(true);
    expect(phaseZeroReviewStrictAcceptanceRecoveryEligible({...exact,maxAttempts:6})).toBe(false);
    expect(phaseZeroReviewStrictAcceptanceRecoveryEligible({...exact,phaseIndex:1})).toBe(false);
    expect(phaseZeroReviewStrictAcceptanceRecoveryEligible({...exact,prompt:'no handoff'})).toBe(false);
    expect(phaseZeroReviewStrictAcceptanceRecoveryEligible({...exact,failure:{failures:[{kind:'outage',message:'EXECUTION_RESULT_BLOCKED'}]}})).toBe(false);
    const cap=campaignPromptRepairRetryCap({phaseZeroStrictAcceptanceEligible:true});
    expect(cap).toBe(6);
    expect(failedCampaignRuntimeRearmDecision({
      objectiveStatus:'blocked',objectiveSummary:MANAGER_NO_PROGRESS_BLOCK_SUMMARY,jobStatus:'failed',
      attempts:5,maxAttempts:5,jobCompletedAt:'2026-10-31T05:57:54Z',runtimeUpdatedAt:'2026-10-31T06:05:00Z',
      hasCampaign:true,routingProfile:'LOCAL',promptRepairEligible:true,promptRepairCap:cap,
    })).toEqual({action:'requeue_prompt_repair',reason:'runtime_source_newer_with_prompt_repair_credit',nextMaxAttempts:6});
  });
  it('recovers one historical strict-correction overshoot after the handoff transport source fix',()=>{
    const exact={
      capability:'review',
      phaseIndex:0,
      attempts:7,
      maxAttempts:6,
      prompt:'x\n\nAUTHORIZED PRIOR CAMPAIGN HANDOFF:\nPRIOR_CAMPAIGN_HANDOFF_V1 {"schema":"TIGERIQ_REFERENCED_JOB_EVIDENCE_V1"}',
      failure:{message:'EXECUTION_RESULT_BLOCKED',failures:[]},
    };
    expect(phaseZeroReviewHandoffTransportRecoveryEligible(exact)).toBe(true);
    expect(phaseZeroReviewHandoffTransportRecoveryEligible({...exact,attempts:6})).toBe(false);
    expect(phaseZeroReviewHandoffTransportRecoveryEligible({...exact,maxAttempts:7})).toBe(false);
    expect(phaseZeroReviewHandoffTransportRecoveryEligible({...exact,phaseIndex:1})).toBe(false);
    expect(phaseZeroReviewHandoffTransportRecoveryEligible({...exact,prompt:'no handoff'})).toBe(false);
    expect(phaseZeroReviewHandoffTransportRecoveryEligible({...exact,failure:{message:'OTHER'}})).toBe(false);
    const cap=campaignPromptRepairRetryCap({phaseZeroHandoffTransportEligible:true});
    expect(cap).toBe(8);
    expect(failedCampaignRuntimeRearmDecision({
      objectiveStatus:'blocked',objectiveSummary:MANAGER_NO_PROGRESS_BLOCK_SUMMARY,jobStatus:'failed',
      attempts:7,maxAttempts:6,jobCompletedAt:'2026-10-31T06:24:21Z',runtimeUpdatedAt:'2026-10-31T06:30:00Z',
      hasCampaign:true,routingProfile:'LOCAL',promptRepairEligible:true,promptRepairCap:cap,
    })).toEqual({action:'requeue_prompt_repair',reason:'runtime_source_newer_with_prompt_repair_credit',nextMaxAttempts:8});
    expect(failedCampaignRuntimeRearmDecision({
      objectiveStatus:'blocked',objectiveSummary:MANAGER_NO_PROGRESS_BLOCK_SUMMARY,jobStatus:'failed',
      attempts:8,maxAttempts:8,jobCompletedAt:'2026-10-31T06:24:21Z',runtimeUpdatedAt:'2026-10-31T06:30:00Z',
      hasCampaign:true,routingProfile:'LOCAL',promptRepairEligible:true,promptRepairCap:8,
    }).reason).toBe('retry_budget_exhausted');
  });

  it('grants one 3-to-4 source repair only to the exact exhausted campaign verifier summary',()=>{
    const jobId='JOB-EVID-OBJ-TEST-P0';
    const exact={
      objectiveStatus:'blocked',objectiveSummary:'campaign verification failed after bounded attempts: '+jobId,
      jobStatus:'failed',attempts:3,maxAttempts:3,
      jobCompletedAt:'2026-10-31T08:30:15Z',runtimeUpdatedAt:'2026-10-31T08:35:00Z',
      hasCampaign:true,routingProfile:'LOCAL',promptRepairEligible:true,promptRepairCap:4,
      campaignVerifierRepair:true,campaignVerifierJobId:jobId,
    };
    expect(failedCampaignRuntimeRearmDecision(exact))
      .toEqual({action:'requeue_prompt_repair',reason:'runtime_source_newer_with_prompt_repair_credit',nextMaxAttempts:4});
    expect(failedCampaignRuntimeRearmDecision({...exact,campaignVerifierJobId:'JOB-OTHER'}).reason).toBe('not_failed_campaign_rearm_guard');
    expect(failedCampaignRuntimeRearmDecision({...exact,campaignVerifierRepair:false}).reason).toBe('not_failed_campaign_rearm_guard');
    expect(failedCampaignRuntimeRearmDecision({...exact,attempts:4,maxAttempts:4,promptRepairCap:4}).reason).toBe('retry_budget_exhausted');
  });

  it('grants one exact 4-to-5 campaign-verifier transport recovery and stops at five',()=>{
    const jobId='JOB-EVID-OBJ-TEST-P0';
    const exact={
      objectiveStatus:'blocked',objectiveSummary:'campaign verification failed after bounded attempts: '+jobId,
      jobStatus:'failed',attempts:4,maxAttempts:4,
      jobCompletedAt:'2026-10-31T08:59:48Z',runtimeUpdatedAt:'2026-10-31T09:05:00Z',
      hasCampaign:true,routingProfile:'LOCAL',promptRepairEligible:true,promptRepairCap:5,
      campaignVerifierRepair:true,campaignVerifierJobId:jobId,
    };
    expect(failedCampaignRuntimeRearmDecision(exact))
      .toEqual({action:'requeue_prompt_repair',reason:'runtime_source_newer_with_prompt_repair_credit',nextMaxAttempts:5});
    expect(failedCampaignRuntimeRearmDecision({...exact,attempts:5,maxAttempts:5}).reason).toBe('retry_budget_exhausted');
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
  it('grants exactly one 6-to-7 retry only when the blocked review had authorized prior campaign evidence',()=>{
    const exact={
      capability:'review',
      phaseIndex:1,
      maxAttempts:6,
      prompt:'x\n\nAUTHORIZED PRIOR CAMPAIGN HANDOFF:\nPRIOR_CAMPAIGN_HANDOFF_V1 {"checkpoint":{"jobId":"JOB-EVID-1"}}',
      failure:{failures:[{kind:'invalid_response',message:'EXECUTION_RESULT_BLOCKED'}]},
    };
    expect(providerPriorCampaignEvidenceRecoveryEligible(exact)).toBe(true);
    expect(providerPriorCampaignEvidenceRecoveryEligible({...exact,maxAttempts:5})).toBe(false);
    expect(providerPriorCampaignEvidenceRecoveryEligible({...exact,prompt:'no handoff'})).toBe(false);
    expect(providerPriorCampaignEvidenceRecoveryEligible({...exact,failure:{failures:[{kind:'invalid_response',message:'EXECUTION_RESULT_JSON_INVALID'}]}})).toBe(false);
    expect(providerPriorCampaignEvidenceRecoveryEligible({...exact,failure:{failures:[{kind:'outage',message:'EXECUTION_RESULT_BLOCKED'}]}})).toBe(false);
    const decisionBase={
      objectiveStatus:'blocked',objectiveSummary:MANAGER_NO_PROGRESS_BLOCK_SUMMARY,jobStatus:'failed',
      attempts:6,maxAttempts:6,jobCompletedAt:'2026-10-31T00:32:39Z',runtimeUpdatedAt:'2026-10-31T00:40:00Z',
      hasCampaign:true,routingProfile:'LOCAL',promptRepairEligible:true,promptRepairCap:7,
    };
    expect(failedCampaignRuntimeRearmDecision(decisionBase))
      .toEqual({action:'requeue_prompt_repair',reason:'runtime_source_newer_with_prompt_repair_credit',nextMaxAttempts:7});
    expect(failedCampaignRuntimeRearmDecision({...decisionBase,attempts:7,maxAttempts:7}).reason).toBe('retry_budget_exhausted');
    expect(failedCampaignRuntimeRearmDecision({...decisionBase,promptRepairCap:99,attempts:7,maxAttempts:7}).reason).toBe('retry_budget_exhausted');
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
    expect(text).not.toContain('JOB-WORK-1');
    expect(text).not.toContain('JOB-FUTURE');
    expect(text.length).toBeLessThanOrEqual(2600);
  });
  it('does not leak stale same-phase reviewer receipts past a verified checkpoint',()=>{
    const text=campaignPriorEvidenceContext({
      currentPhase:1,
      checkpoints:[{phaseIndex:0,phaseNumber:1,phaseTitle:'Receipt verification',summary:'Verified current checkpoint',jobId:'JOB-EVID-CURRENT',employeeId:'NV10',resourceId:'res:nv10',completedAt:'2026-10-31T10:46:25Z'}],
      jobs:[
        {id:'JOB-OLD-REVIEW',title:'Historical review',phase_index:0,kind:'compiled_ai',status:'done',employee_id:'NV09',resource_id:'res:nv09',provider:'ollama',completed_at:'2026-10-31T08:10:14Z',result:{text:'historical receipt'}},
        {id:'JOB-EVID-CURRENT',title:'Current verified phase receipt',phase_index:0,kind:'compiled_campaign',status:'done',employee_id:'NV10',resource_id:'res:nv10',provider:'ollama',completed_at:'2026-10-31T10:46:25Z',result:{text:'current receipt',executionGate:{pass:true,code:'EXECUTION_ACCEPTED',evidenceIds:['e1']}}},
      ],
    });
    expect(text).toContain('JOB-EVID-CURRENT');
    expect(text).toContain('current receipt');
    expect(text).not.toContain('JOB-OLD-REVIEW');
    expect(text).not.toContain('res:nv09');
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
  it('replaces stale authorized handoff while preserving active skill context',()=>{
    const original=[
      'PACKET_JSON: {"task_id":"JOB-2"}',
      'OUTPUT REQUIREMENT: JSON only',
      '',
      'AUTHORIZED PRIOR CAMPAIGN HANDOFF:',
      'PRIOR_CAMPAIGN_HANDOFF_V1 {"checkpoint":{"jobId":"JOB-OLD"}}',
      '',
      'ACTIVE SKILLS (use only when relevant; never expand permissions):',
      '[SKILL role-separated-execution v1.0.0]',
      'keep reviewer independent',
    ].join('\n');
    const context='PRIOR_CAMPAIGN_HANDOFF_V1 {"checkpoint":{"jobId":"JOB-EVID-CURRENT"}}';
    const repaired=repairCampaignReviewPrompt(original,context);
    expect(repaired.changed).toBe(true);
    expect(repaired.reason).toBe('prior_context_replaced');
    expect(repaired.prompt).toContain('JOB-EVID-CURRENT');
    expect(repaired.prompt).not.toContain('JOB-OLD');
    expect(repaired.prompt).toContain('ACTIVE SKILLS (use only when relevant; never expand permissions):');
    expect(repaired.prompt).toContain('keep reviewer independent');
    const second=repairCampaignReviewPrompt(repaired.prompt,context);
    expect(second.changed).toBe(false);
    expect(second.reason).toBe('prior_context_already_present');
  });
  it('repairs raw prior-evidence text when the authorized handoff marker is absent',()=>{
    const original='PACKET_JSON: {"goal":"PRIOR_CAMPAIGN_HANDOFF_V1 mentioned without an authorized marker"}';
    const context='PRIOR_CAMPAIGN_HANDOFF_V1 {"schema":"TIGERIQ_REFERENCED_JOB_EVIDENCE_V1","refs":["JOB-REF-1"],"receipts":[]}';
    const repaired=repairCampaignReviewPrompt(original,context);
    expect(repaired.changed).toBe(true);
    expect(repaired.reason).toBe('prior_context_appended');
    expect(repaired.prompt).toContain('AUTHORIZED PRIOR CAMPAIGN HANDOFF:');
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
