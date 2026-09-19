// @ts-nocheck
import {describe,it,expect} from 'vitest';
import {normalizeCampaignPhases,currentCampaignGoal,campaignTransition,makePhaseCheckpoint,campaignNeedsEvidence,campaignEvidenceJobId,projectWorkItemLifecycle,WORKITEM_LIFECYCLE_STATES} from '../apps/tigeriq-core/campaign-runner.mjs';

const phases=[
  {title:'Checkpoint',prompt:'Design durable resume',acceptance:'Resume without Owner'},
  {title:'Knowledge',prompt:'Design source-aware index'},
  {title:'Visibility',prompt:'Design orchestration truth'}
];

describe('API campaign runner',()=>{
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
  it('projects canonical Core WorkItem V1 lifecycle states accurately',()=>{
    expect(WORKITEM_LIFECYCLE_STATES).toEqual(['QUEUED', 'CLAIMED', 'WORKING', 'EVIDENCE', 'VERIFY', 'DONE', 'BLOCKED']);
    expect(projectWorkItemLifecycle({objective:{status:'queued'},jobs:[]})).toBe('QUEUED');
    expect(projectWorkItemLifecycle({objective:{status:'running'},jobs:[{status:'claimed'}]})).toBe('CLAIMED');
    expect(projectWorkItemLifecycle({objective:{status:'running'},jobs:[{status:'running'}]})).toBe('WORKING');
    expect(projectWorkItemLifecycle({objective:{status:'running'},jobs:[{kind:'evidence',result:'ok'}]})).toBe('EVIDENCE');
    expect(projectWorkItemLifecycle({objective:{status:'running'},jobs:[{kind:'verify'}]})).toBe('VERIFY');
    expect(projectWorkItemLifecycle({objective:{status:'done'},jobs:[]})).toBe('DONE');
    expect(projectWorkItemLifecycle({objective:{status:'blocked'},jobs:[]})).toBe('BLOCKED');
  });
});
