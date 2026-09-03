import { describe,expect,it } from 'vitest';
import { assignIndependentReviewer,judgeFromChecks,providerCapacity,resolveEmployee,routeModels,scheduleReadyTasks,selectFallback,selectRoute,validateRegistry } from '../apps/ai-gateway/src/core.js';
import type { EmployeeDefinition,ModelDefinition,ProviderDefinition,WorkTask } from '../apps/ai-gateway/src/core.js';

const providers:ProviderDefinition[]=[
  {providerId:'ollama',kind:'local',enabled:true,healthy:true,costClass:'free',maxConcurrency:2,latencyMs:120},
  {providerId:'gemini',kind:'external',enabled:true,healthy:true,costClass:'metered',maxConcurrency:4,remainingQuota:100,latencyMs:250},
  {providerId:'openai',kind:'external',enabled:true,healthy:true,costClass:'paid',maxConcurrency:3,remainingQuota:100,latencyMs:180}
];
const models:ModelDefinition[]=[
  {modelId:'qwen3-8b',providerId:'ollama',enabled:true,capabilities:['reasoning','coding','review','fast'],quality:72,speed:85,contextTokens:32768,costWeight:0},
  {modelId:'gemini-pro',providerId:'gemini',enabled:true,capabilities:['reasoning','coding','research','vision','review','judge','long-context'],quality:92,speed:75,contextTokens:1000000,costWeight:1},
  {modelId:'gpt-main',providerId:'openai',enabled:true,capabilities:['reasoning','coding','research','review','judge','long-context'],quality:96,speed:70,contextTokens:200000,costWeight:3}
];

describe('multi AI gateway',()=>{
  it('validates provider/model/employee references',()=>{
    const employees:EmployeeDefinition[]=[{employeeId:'coder-1',role:'coder',enabled:true,requiredCapabilities:['coding'],preferredModels:['qwen3-8b']}];
    expect(()=>validateRegistry(providers,models,employees)).not.toThrow();
    expect(()=>validateRegistry(providers,[{...models[0],providerId:'missing'}],[])).toThrow('INVALID_OR_DUPLICATE_MODEL');
  });

  it('prefers capable free/local models for routine work',()=>{
    const route=selectRoute(providers,models,{requiredCapabilities:['coding'],preferFree:true});
    expect(route?.model.modelId).toBe('qwen3-8b');
  });

  it('routes high capability work to a model that actually supports it',()=>{
    const candidates=routeModels(providers,models,{requiredCapabilities:['vision','judge'],preferFree:true});
    expect(candidates.map(row=>row.model.modelId)).toEqual(['gemini-pro']);
  });

  it('provides a different-provider fallback when requested',()=>{
    const primary=selectRoute(providers,models,{requiredCapabilities:['coding'],preferFree:false})!;
    const fallback=selectFallback(primary,providers,models,{requiredCapabilities:['coding'],preferFree:false,requireExternalDiversity:true});
    expect(fallback).toBeDefined();
    expect(fallback?.provider.providerId).not.toBe(primary.provider.providerId);
  });

  it('resolves employee roles through the shared router',()=>{
    const employee:EmployeeDefinition={employeeId:'research-1',role:'researcher',enabled:true,requiredCapabilities:['research','long-context']};
    expect(resolveEmployee(employee,providers,models,true)?.model.modelId).toBe('gemini-pro');
  });

  it('maximizes ready parallel tasks while respecting dependencies and provider concurrency',()=>{
    const tasks:WorkTask[]=[
      {taskId:'A',goalId:'G',stage:'done',dependencies:[],requiredCapabilities:['research'],priority:'P0',attempts:1},
      {taskId:'B',goalId:'G',stage:'queued',dependencies:['A'],requiredCapabilities:['coding'],priority:'P0',attempts:0},
      {taskId:'C',goalId:'G',stage:'queued',dependencies:[],requiredCapabilities:['coding'],priority:'P1',attempts:0},
      {taskId:'D',goalId:'G',stage:'queued',dependencies:['missing'],requiredCapabilities:['coding'],priority:'P0',attempts:0}
    ];
    const scheduled=scheduleReadyTasks(tasks,providers,models,{globalConcurrency:3,providerRunning:{ollama:1}});
    expect(scheduled.map(row=>row.task.taskId)).toEqual(['B','C']);
    expect(scheduled.every(row=>row.route.provider.providerId==='ollama'||row.route.provider.providerId==='gemini'||row.route.provider.providerId==='openai')).toBe(true);
  });

  it('assigns independent reviewers instead of self-approval',()=>{
    const task:WorkTask={taskId:'T1',goalId:'G',stage:'review',dependencies:[],requiredCapabilities:['coding'],priority:'P0',attempts:1,authorModelId:'qwen3-8b'};
    const review=assignIndependentReviewer(task,providers,models);
    expect(review?.independent).toBe(true);
    expect(review?.reviewerModelId).not.toBe('qwen3-8b');
  });

  it('enforces final judge outcomes',()=>{
    expect(judgeFromChecks({testsPassed:true,reviewPassed:true,authorizationRequired:false,blocked:false})).toBe('pass');
    expect(judgeFromChecks({testsPassed:false,reviewPassed:true,authorizationRequired:false,blocked:false})).toBe('fix');
    expect(judgeFromChecks({testsPassed:true,reviewPassed:true,authorizationRequired:true,blocked:false})).toBe('authorization');
    expect(judgeFromChecks({testsPassed:true,reviewPassed:true,authorizationRequired:false,blocked:true})).toBe('blocked');
  });

  it('reports remaining provider workforce capacity',()=>{
    expect(providerCapacity(providers,{ollama:2,gemini:1,openai:0})).toBe(6);
  });
});
