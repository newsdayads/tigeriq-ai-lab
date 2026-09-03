import { describe,expect,it } from 'vitest';
import { AiGatewayExecutor,routingPolicyFromRoutes } from '../apps/ai-gateway/src/adapters.js';
import { RoutingExhaustedError,type ProviderAdapter } from '../packages/model-router/src/index.js';
import type { RouteCandidate } from '../apps/ai-gateway/src/core.js';

const routes:RouteCandidate[]=[
  {provider:{providerId:'gemini',kind:'external',enabled:true,healthy:true,costClass:'metered',maxConcurrency:2},model:{modelId:'gemini-main',providerId:'gemini',enabled:true,capabilities:['coding'],quality:90,speed:80,contextTokens:32000,costWeight:1},score:100},
  {provider:{providerId:'openai',kind:'external',enabled:true,healthy:true,costClass:'paid',maxConcurrency:2},model:{modelId:'openai-main',providerId:'openai',enabled:true,capabilities:['coding'],quality:85,speed:80,contextTokens:32000,costWeight:2},score:90}
];
function adapter(provider:ProviderAdapter['provider'],execute:ProviderAdapter['execute']):ProviderAdapter{return {provider,execute};}

describe('AI gateway canonical router integration',()=>{
  it('falls back across providers through the existing ModelRouter',async()=>{
    const executor=new AiGatewayExecutor([
      adapter('gemini',async()=>{throw new Error('rate_limited');}),
      adapter('openai',async()=> 'ok')
    ]);
    const result=await executor.execute(routes,{requestId:'REQ-1',taskId:'TASK-1',prompt:'build feature'},2);
    expect(result.output).toBe('ok');
    expect(result.providerId).toBe('openai');
    expect(result.attempts).toEqual([
      {providerId:'gemini',modelId:'gemini-main',ok:false,reason:'rate_limited',circuitOpen:undefined},
      {providerId:'openai',modelId:'openai-main',ok:true,reason:undefined,circuitOpen:undefined}
    ]);
  });

  it('retains canonical circuit-breaker state across gateway executions',async()=>{
    let calls=0;
    let now=1000;
    const executor=new AiGatewayExecutor([
      adapter('gemini',async()=>{calls++;throw new Error('outage');}),
      adapter('openai',async()=> 'fallback')
    ],{failureThreshold:2,cooldownMs:100,now:()=>now});
    await executor.execute(routes,{requestId:'REQ-A',taskId:'TASK-A',prompt:'one'});
    await executor.execute(routes,{requestId:'REQ-B',taskId:'TASK-B',prompt:'two'});
    const third=await executor.execute(routes,{requestId:'REQ-C',taskId:'TASK-C',prompt:'three'});
    expect(calls).toBe(2);
    expect(third.attempts[0]).toMatchObject({providerId:'gemini',ok:false,reason:'circuit open',circuitOpen:true});
    now+=101;
    await executor.execute(routes,{requestId:'REQ-D',taskId:'TASK-D',prompt:'four'});
    expect(calls).toBe(3);
  });

  it('fails closed through RoutingExhaustedError when adapters are unavailable',async()=>{
    const executor=new AiGatewayExecutor([]);
    await expect(executor.execute(routes.slice(0,1),{requestId:'REQ-2',taskId:'TASK-2',prompt:'x'})).rejects.toBeInstanceOf(RoutingExhaustedError);
  });

  it('rejects unsupported providers before execution',()=>{
    const unsupported:RouteCandidate={...routes[0],provider:{...routes[0].provider,providerId:'unknown-provider'},model:{...routes[0].model,providerId:'unknown-provider'}};
    expect(()=>routingPolicyFromRoutes([unsupported])).toThrow('UNSUPPORTED_PROVIDER');
  });
});
