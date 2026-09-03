import { describe,expect,it } from 'vitest';
import { AdapterRegistry,executeWithRoutes } from '../apps/ai-gateway/src/adapters.js';
import type { RouteCandidate } from '../apps/ai-gateway/src/core.js';

const routes:RouteCandidate[]=[
  {provider:{providerId:'p1',kind:'external',enabled:true,healthy:true,costClass:'metered',maxConcurrency:2},model:{modelId:'m1',providerId:'p1',enabled:true,capabilities:['coding'],quality:90,speed:80,contextTokens:32000,costWeight:1},score:100},
  {provider:{providerId:'p2',kind:'external',enabled:true,healthy:true,costClass:'metered',maxConcurrency:2},model:{modelId:'m2',providerId:'p2',enabled:true,capabilities:['coding'],quality:85,speed:80,contextTokens:32000,costWeight:1},score:90}
];

describe('AI gateway adapters',()=>{
  it('falls back across providers through one normalized contract',async()=>{
    const registry=new AdapterRegistry();
    registry.register({providerId:'p1',invoke:async()=>{throw new Error('rate_limited');}});
    registry.register({providerId:'p2',invoke:async request=>({requestId:request.requestId,providerId:request.providerId,modelId:request.modelId,output:'ok',latencyMs:12,finishReason:'stop'})});
    const result=await executeWithRoutes({routes,request:{requestId:'REQ-1',taskId:'TASK-1',prompt:'build feature'},registry,maxAttempts:2});
    expect(result.response?.output).toBe('ok');
    expect(result.attempts).toEqual([
      {providerId:'p1',modelId:'m1',ok:false,reason:'rate_limited'},
      {providerId:'p2',modelId:'m2',ok:true}
    ]);
  });

  it('fails closed when adapter is unavailable',async()=>{
    const registry=new AdapterRegistry();
    const result=await executeWithRoutes({routes:[routes[0]],request:{requestId:'REQ-2',taskId:'TASK-2',prompt:'x'},registry});
    expect(result.response).toBeUndefined();
    expect(result.attempts[0]).toMatchObject({ok:false,reason:'adapter_missing'});
  });

  it('rejects duplicate provider adapters',()=>{
    const registry=new AdapterRegistry();
    registry.register({providerId:'p1',invoke:async request=>({requestId:request.requestId,providerId:'p1',modelId:request.modelId,output:'ok',latencyMs:1,finishReason:'stop'})});
    expect(()=>registry.register({providerId:'p1',invoke:async request=>({requestId:request.requestId,providerId:'p1',modelId:request.modelId,output:'ok',latencyMs:1,finishReason:'stop'})})).toThrow('INVALID_OR_DUPLICATE_ADAPTER');
  });
});
