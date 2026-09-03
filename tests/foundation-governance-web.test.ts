import { describe,expect,it } from 'vitest';
import { canDispatchRateLimited,checkUsage,rateCapacity } from '../apps/ai-governance/src/core.js';
import { addReview,appendEvidenceRecord,evaluateEvidence,finalDoneAllowed } from '../apps/evidence-engine/src/core.js';
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

  it('layers independent review and judge on canonical machine evidence before DONE',()=>{
    let bundle:EvidenceBundle={version:1,subjectId:'T1',records:[],reviews:[]};
    bundle=appendEvidenceRecord(bundle,{id:'E1',workOrderId:'T1',gate:'TEST',commitSha:'abcdef123',command:'npm test',exitCode:0,status:'pass',timestamp:'2026-09-04T00:00:00.000Z'});
    bundle=appendEvidenceRecord(bundle,{id:'E2',workOrderId:'T1',gate:'BUILD',commitSha:'abcdef123',command:'npm run build',exitCode:0,status:'pass',timestamp:'2026-09-04T00:00:01.000Z'});
    bundle=addReview(bundle,{reviewerId:'R1',reviewerModelId:'gemini-pro',authorModelId:'qwen3-8b',passed:true,findings:[],recordedAt:'2026-09-04T00:00:02.000Z'});
    const policy={requiredGates:['TEST','BUILD'],minIndependentReviews:1,requireJudge:true};
    expect(evaluateEvidence(bundle,policy).reason).toBe('judge_missing');
    bundle={...bundle,judge:{decision:'pass',reason:'all gates pass',recordedAt:'2026-09-04T00:00:03.000Z'}};
    expect(finalDoneAllowed(bundle,policy)).toBe(true);
    expect(()=>addReview(bundle,{reviewerId:'R2',reviewerModelId:'qwen3-8b',authorModelId:'qwen3-8b',passed:true,findings:[],recordedAt:'2026-09-04T00:00:04.000Z'})).toThrow('SELF_REVIEW_FORBIDDEN');
  });

  it('uses the latest canonical gate record so a later failure prevents false DONE',()=>{
    let bundle:EvidenceBundle={version:1,subjectId:'T9',records:[],reviews:[],judge:{decision:'pass',reason:'judge pass',recordedAt:'2026-09-04T00:00:05.000Z'}};
    bundle=appendEvidenceRecord(bundle,{id:'PASS1',workOrderId:'T9',gate:'TEST',commitSha:'abcdef123',command:'npm test',exitCode:0,status:'pass',timestamp:'2026-09-04T00:00:00.000Z'});
    bundle=appendEvidenceRecord(bundle,{id:'FAIL2',workOrderId:'T9',gate:'TEST',commitSha:'abcdef124',command:'npm test',exitCode:1,status:'fail',timestamp:'2026-09-04T00:00:04.000Z'});
    expect(evaluateEvidence(bundle,{requiredGates:['TEST'],minIndependentReviews:0,requireJudge:true})).toEqual({ready:false,reason:'failed_evidence:TEST'});
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
    const evidence:EvidenceBundle[]=[{version:1,subjectId:'T3',records:[],reviews:[],judge:{decision:'pass',reason:'pass',recordedAt:'2026-09-04T00:00:00.000Z'}}];
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
