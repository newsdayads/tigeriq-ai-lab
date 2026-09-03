import { describe,expect,it } from 'vitest';
import { canDispatchRateLimited,checkUsage,rateCapacity } from '../apps/ai-governance/src/core.js';
import { addReview,appendEvidence,evaluateEvidence,finalDoneAllowed } from '../apps/evidence-engine/src/core.js';
import { buildWebControlSnapshot } from '../apps/web-control/src/core.js';
import type { EvidenceBundle } from '../apps/evidence-engine/src/core.js';
import type { ProviderDefinition,EmployeeDefinition,WorkTask } from '../apps/ai-gateway/src/core.js';
import type { ContinuousRuntimeState } from '../apps/continuous-operations/src/core.js';

describe('governance evidence and web control projection',()=>{
  it('holds paid requests under free-only policy and blocks hard budget overruns',()=>{
    const current={providerId:'openai',requests:2,inputTokens:1000,outputTokens:500,estimatedCostUsd:0,windowStartedAt:'2026-09-04T00:00:00.000Z'};
    const freeOnly={mode:'free-only' as const,maxEstimatedCostUsd:10,maxRequests:100,maxTokens:100000,requireApprovalAboveUsd:1};
    expect(checkUsage(freeOnly,current,{requests:1,inputTokens:100,outputTokens:100,estimatedCostUsd:0.2}).decision).toBe('authorization');
    const budgeted={...freeOnly,mode:'budgeted' as const,maxEstimatedCostUsd:0.1};
    expect(checkUsage(budgeted,current,{requests:1,inputTokens:100,outputTokens:100,estimatedCostUsd:0.2}).decision).toBe('blocked');
  });

  it('respects provider rate windows',()=>{
    const window={providerId:'gemini',limit:10,used:9,resetAt:'2026-09-04T00:10:00.000Z'};
    expect(rateCapacity(window,Date.parse('2026-09-04T00:05:00.000Z'))).toBe(1);
    expect(canDispatchRateLimited(window,Date.parse('2026-09-04T00:05:00.000Z'),2)).toBe(false);
    expect(rateCapacity(window,Date.parse('2026-09-04T00:11:00.000Z'))).toBe(10);
  });

  it('requires evidence, independent review and judge before DONE',()=>{
    let bundle:EvidenceBundle={version:1,subjectId:'T1',items:[],reviews:[]};
    bundle=appendEvidence(bundle,{evidenceId:'E1',kind:'test',subjectId:'T1',passed:true,source:'vitest',recordedAt:'2026-09-04T00:00:00.000Z',summary:'tests pass'});
    bundle=appendEvidence(bundle,{evidenceId:'E2',kind:'artifact',subjectId:'T1',passed:true,source:'repo',recordedAt:'2026-09-04T00:00:01.000Z',summary:'artifact exists'});
    bundle=addReview(bundle,{reviewerId:'R1',reviewerModelId:'gemini-pro',authorModelId:'qwen3-8b',passed:true,findings:[]});
    const policy={requiredKinds:['test','artifact'] as const,minIndependentReviews:1,requireJudge:true};
    expect(evaluateEvidence(bundle,{...policy,requiredKinds:[...policy.requiredKinds]}).reason).toBe('judge_missing');
    bundle={...bundle,judge:{decision:'pass',reason:'all gates pass'}};
    expect(finalDoneAllowed(bundle,{...policy,requiredKinds:[...policy.requiredKinds]})).toBe(true);
    expect(()=>addReview(bundle,{reviewerId:'R2',reviewerModelId:'qwen3-8b',authorModelId:'qwen3-8b',passed:true,findings:[]})).toThrow('SELF_REVIEW_FORBIDDEN');
  });

  it('projects real queue/workforce/provider/authorization data for Web Control',()=>{
    const continuous:ContinuousRuntimeState={version:1,goals:{
      A:{stage:'running',updatedAt:'2026-09-04T00:00:00.000Z',missionId:'OPS-A'},
      B:{stage:'waiting_authorization',updatedAt:'2026-09-04T00:00:00.000Z',missionId:'OPS-B'},
      C:{stage:'done',updatedAt:'2026-09-04T00:00:00.000Z',missionId:'OPS-C'}
    }};
    const tasks:WorkTask[]=[
      {taskId:'T1',goalId:'A',stage:'running',dependencies:[],requiredCapabilities:['coding'],priority:'P0',attempts:1},
      {taskId:'T2',goalId:'B',stage:'authorization',dependencies:[],requiredCapabilities:['reasoning'],priority:'P0',attempts:0},
      {taskId:'T3',goalId:'C',stage:'done',dependencies:[],requiredCapabilities:['review'],priority:'P1',attempts:1}
    ];
    const providers:ProviderDefinition[]=[{providerId:'ollama',kind:'local',enabled:true,healthy:true,costClass:'free',maxConcurrency:2}];
    const employees:EmployeeDefinition[]=[{employeeId:'coder-01',role:'coder',enabled:true,requiredCapabilities:['coding']}];
    const evidence:EvidenceBundle[]=[{version:1,subjectId:'T3',items:[],reviews:[],judge:{decision:'pass',reason:'pass'}}];
    const snapshot=buildWebControlSnapshot({continuous,tasks,workers:[{workerId:'W1',employeeId:'coder-01',status:'busy',currentTaskId:'T1'}],providers,employees,evidence,now:'2026-09-04T00:05:00.000Z'});
    expect(snapshot.goals).toMatchObject({running:1,waitingAuthorization:1,done:1});
    expect(snapshot.tasks.authorization).toBe(1);
    expect(snapshot.authorization.goalIds).toEqual(['B']);
    expect(snapshot.authorization.taskIds).toEqual(['T2']);
    expect(snapshot.workers.busy).toBe(1);
    expect(snapshot.providers[0].providerId).toBe('ollama');
    expect(snapshot.evidence.judgePass).toBe(1);
  });
});
