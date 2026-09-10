import { describe, expect, it } from 'vitest';
import { createGeminiAdapter, ModelRouter, type ProviderAdapter } from '../packages/model-router/src/index.js';
const target={provider:'gemini' as const,model:'gemini-3.5-flash-lite'};
const make=(fetchImpl:typeof fetch,timeoutMs=100)=>createGeminiAdapter({apiKey:'test_only',freeTierVerified:true,model:'gemini-3.5-flash-lite',fetchImpl,timeoutMs});
describe('Gemini resilience',()=>{
  it('classifies quota and service outage',async()=>{
    const quota=make(async()=>new Response('{}',{status:429,headers:{'retry-after':'2'}}));
    await expect(quota.execute(target,{prompt:'x'})).rejects.toMatchObject({kind:'quota',retryAfterMs:2000});
    const outage=make(async()=>new Response('{}',{status:503}));
    await expect(outage.execute(target,{prompt:'x'})).rejects.toMatchObject({kind:'outage'});
  });
  it('bounds timeout',async()=>{
    const hung=make(((_input,init)=>new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))) as typeof fetch,10);
    await expect(hung.execute(target,{prompt:'x'})).rejects.toMatchObject({kind:'timeout'});
  });
  it('falls back after Gemini quota without retry loop',async()=>{
    const gemini=make(async()=>new Response('{}',{status:429}));
    const fallback:ProviderAdapter={provider:'groq',execute:async()=> 'fallback-ok'};
    const router=new ModelRouter([gemini,fallback],{primary:target,fallbacks:[{provider:'groq',model:'openai/gpt-oss-120b'}]});
    const result=await router.execute({prompt:'x'});
    expect(result.target.provider).toBe('groq');
    expect(result.attempts).toMatchObject([{ok:false,failureKind:'quota'},{ok:true}]);
  });
});