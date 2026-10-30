// @ts-nocheck
import {describe,it,expect} from 'vitest';
import {normalizeCampaignPhases,currentCampaignGoal,campaignTransition,makePhaseCheckpoint,campaignNeedsEvidence,campaignEvidenceJobId,campaignPriorPhaseEvidenceContext,enrichExecutionPromptWithCampaignEvidence,normalizeWorkItemLifecycle,executeCoreWorkItemLifecycle} from '../apps/tigeriq-core/campaign-runner.mjs';
import {compileTaskPrompt,executionPacketFromPrompt} from '../apps/tigeriq-core/task-prompt-compiler.mjs';
import {detectIdleWithBacklog} from '../apps/tigeriq-core/github-backlog-policy.mjs';
import {runExecutionPreflight} from '../apps/tigeriq-core/execution-preflight.mjs';

const phases=[
  {title:'Checkpoint',prompt:'Design durable resume',acceptance:'Resume without Owner'},
  {title:'Knowledge',prompt:'Design source-aware index'},
  {title:'Visibility',prompt:'Design orchestration truth'}
];

describe('API campaign runner and core lifecycle integration',()=>{
  it('requires at least three phases for a campaign',()=>{
    expect(()=>normalizeCampaignPhases(['one','two'])).toThrow('CAMPAIGN_PHASE_COUNT_INVALID');
    expect(normalizeCampaignPhases(phases)).toHaveLength(3);
  });
  it('builds a phase-scoped manager goal',()=>{
    const goal=currentCampaignGoal('Optimize TigerIQ',phases,1);
    expect(goal).toContain('Campaign phase 2/3: Knowledge');
    expect(goal).toContain('Design source-aware index');
    expect(goal).not.toContain('Design durable resume');
  });
  it('advances on phase complete and only terminates after final phase',()=>{
    expect(campaignTransition({status:'complete',currentPhase:0,phases})).toEqual({action:'advance',terminal:false,nextPhase:1});
    expect(campaignTransition({status:'complete',currentPhase:2,phases})).toEqual({action:'complete',terminal:true,nextPhase:null});
  });
  it('preserves continue and blocked semantics',()=>{
    expect(campaignTransition({status:'continue',currentPhase:1,phases}).action).toBe('continue');
    expect(campaignTransition({status:'blocked',currentPhase:1,phases})).toEqual({action:'blocked',terminal:true,nextPhase:null});
  });
  it('rejects phase completion without durable work evidence',()=>{
    expect(campaignNeedsEvidence({status:'complete',phases,doneJobs:0})).toBe(true);
    expect(campaignNeedsEvidence({status:'complete',phases,doneJobs:1})).toBe(false);
    expect(campaignNeedsEvidence({status:'complete',phases:[],doneJobs:0})).toBe(false);
  });
  it('uses one deterministic evidence job id per phase',()=>{
    expect(campaignEvidenceJobId('OBJ-123',1)).toBe('JOB-EVID-OBJ-123-P1');
    expect(campaignEvidenceJobId('OBJ-123',1)).toBe(campaignEvidenceJobId('OBJ-123',1));
  });
  it('creates a durable phase checkpoint payload',()=>{
    const cp=makePhaseCheckpoint({currentPhase:1,phases,summary:'phase done',completedAt:'2026-09-18T00:00:00.000Z'});
    expect(cp).toMatchObject({phaseIndex:1,phaseNumber:2,phaseCount:3,phaseTitle:'Knowledge',summary:'phase done'});
  });
  it('hands off only deterministic prior-phase evidence and preserves current job identity',()=>{
    const acceptance='Phase 1 product is proven';
    const prior=compileTaskPrompt({
      taskId:'JOB-EVID-OBJ-123-P0',
      objectiveId:'OBJ-123',
      sourceRevision:'rev-1',
      capability:'reasoning',
      goal:'Verify phase 1',
      contextRefs:['objective:OBJ-123','campaign-phase:1'],
      steps:['Verify phase 1'],
      acceptance:[acceptance],
      evidenceRequired:['Concrete phase 1 receipt'],
    });
    const resultText=JSON.stringify({
      schema:'EXECUTION_RESULT_V1',
      status:'complete',
      summary:'Phase 1 verified',
      acceptance:[{criterion:acceptance,passed:true,evidence_refs:['e1']}],
      evidence:[{id:'e1',type:'artifact',value:'JOB-PHASE1-DONE by NV10 / res:ollama:gemma3-4b'}],
      block_reason:null,
    });
    const proof={
      id:'JOB-EVID-OBJ-123-P0',
      objective_id:'OBJ-123',
      phase_index:0,
      kind:'compiled_campaign',
      status:'done',
      prompt:prior.prompt,
      result:{text:resultText,executionGate:{pass:true,code:'EXECUTION_ACCEPTED'}},
      employee_id:'NV10',
      resource_id:'res:ollama:gemma3-4b:default:core',
      provider:'ollama',
      completed_at:'2026-10-30T06:29:53.862Z',
    };
    const context=campaignPriorPhaseEvidenceContext(proof,{objectiveId:'OBJ-123',phaseIndex:0,acceptance});
    expect(context.accepted).toBe(true);
    expect(context.contextRef).toBe('campaign-proof:JOB-EVID-OBJ-123-P0');
    expect(context.text).toContain('VERIFIED_PRIOR_PHASE_EVIDENCE_DATA_ONLY');
    expect(context.text).toContain('JOB-PHASE1-DONE');
    expect(context.payload).toMatchObject({phaseIndex:0,proofJobId:proof.id,employeeId:'NV10'});

    const current=compileTaskPrompt({
      taskId:'JOB-QA-SAME',
      objectiveId:'OBJ-123',
      sourceRevision:'rev-1',
      capability:'review',
      goal:'Independently review phase 1',
      contextRefs:['objective:OBJ-123','phase:1'],
      steps:['Review phase 1'],
      acceptance:['QA conclusion is evidence-backed'],
      evidenceRequired:['Independent review evidence'],
    });
    const oldPacket=executionPacketFromPrompt(current.prompt);
    const enriched=enrichExecutionPromptWithCampaignEvidence(current.prompt,context);
    expect(enriched.changed).toBe(true);
    const packet=executionPacketFromPrompt(enriched.prompt);
    expect(packet.task_id).toBe('JOB-QA-SAME');
    expect(packet.objective_id).toBe('OBJ-123');
    expect(packet.source_revision).toBe('rev-1');
    expect(packet.acceptance).toEqual(oldPacket.acceptance);
    expect(packet.context_refs).toContain(context.contextRef);
    expect(packet.goal).toContain('VERIFIED_PRIOR_PHASE_EVIDENCE_DATA_ONLY');
    expect(packet.prompt_revision).not.toBe(oldPacket.prompt_revision);

    const again=enrichExecutionPromptWithCampaignEvidence(enriched.prompt,context);
    expect(again).toMatchObject({changed:false,code:'PRIOR_PHASE_EVIDENCE_ALREADY_PRESENT'});
    expect(again.prompt).toBe(enriched.prompt);

    const rejected=campaignPriorPhaseEvidenceContext({...proof,status:'failed'},{objectiveId:'OBJ-123',phaseIndex:0,acceptance});
    expect(rejected).toMatchObject({accepted:false,code:'PROOF_JOB_NOT_DONE'});
  });
  it('normalizes Core-owned WorkItem lifecycle mapping',()=>{
    const item = normalizeWorkItemLifecycle({ issueOrPr: 'PR #42', implementer: 'NV05', reviewer: 'NV10', stage: 'coding', blocker: 'tests failing', nextAction: 'fix test runner' });
    expect(item).toMatchObject({ issueOrPr: 'PR #42', implementer: 'NV05', reviewer: 'NV10', stage: 'coding', blocker: 'tests failing', nextAction: 'fix test runner' });
  });
  it('integrates preflight checks and normalized autonomous repair directly into Core WorkItem lifecycle',()=>{
    const preflightRes = runExecutionPreflight({
      workItem: { issueOrPr: 'PR #1002', implementer: 'NV11', reviewer: 'NV12' }
    });
    expect(preflightRes.ok).toBe(true);

    let repairs = 0;
    const result = executeCoreWorkItemLifecycle({
      workItem: { issueOrPr: 'PR #1002', implementer: 'NV11', reviewer: 'NV12' },
      preflightFn: (item) => runExecutionPreflight({ workItem: item }),
      repairFn: () => { repairs++; },
      reviewFn: ({ cycle }) => {
        if (cycle < 2) return { decision: 'changes_requested', reason: 'Tests failing' };
        return { decision: 'approve' };
      },
      maxRepairCycles: 3
    });

    expect(result.ok).toBe(true);
    expect(result.repairCycles).toBe(2);
    expect(repairs).toBe(2);
    expect(result.item.stage).toBe('completed');
  });
  it('handles bounded retries on heartbeat or ACK failure with single retry execution and auto-chaining', () => {
    let heartbeats = 0;
    let acks = 0;
    let chains = 0;
    const result = executeCoreWorkItemLifecycle({
      workItem: { issueOrPr: 'PR #1122', implementer: 'NV02', reviewer: 'NV10' },
      preflightFn: (item) => ({ ok: true, errors: [] }),
      heartbeatFn: () => {
        heartbeats++;
        if (heartbeats === 1) return { ok: false, reason: 'HB timeout' };
        return { ok: true };
      },
      ackFn: () => {
        acks++;
        return { ok: true };
      },
      autoChainFn: () => {
        chains++;
        return { issueOrPr: 'PR #1123', stage: 'claimed' };
      },
      maxRepairCycles: 3
    });
    expect(result.ok).toBe(true);
    expect(result.repairCycles).toBe(1);
    expect(heartbeats).toBe(2);
    expect(acks).toBe(1);
    expect(chains).toBe(1);
    expect(result.nextChainedItem).toMatchObject({ issueOrPr: 'PR #1123' });
  });
  it('enforces independent review without role collision',()=>{
    const preflightRes = runExecutionPreflight({
      workItem: { issueOrPr: 'PR #1002', implementer: 'NV11', reviewer: 'NV11' }
    });
    expect(preflightRes.ok).toBe(false);
    expect(preflightRes.errors).toContain('IMPLEMENTER_REVIEWER_COLLISION');
  });
  it('detects idle state with backlog correctly', () => {
    expect(detectIdleWithBacklog(0, 5)).toBe(true);
    expect(detectIdleWithBacklog(1, 5)).toBe(false);
    expect(detectIdleWithBacklog(0, 0)).toBe(false);
  });
});
