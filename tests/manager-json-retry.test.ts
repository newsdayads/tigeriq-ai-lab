// @ts-nocheck
import {describe,it,expect} from 'vitest';
import {managerLocalRequestBody,managerResponseFormatForHost,managerShouldUseLocalFallback,parseManagerJson,runBoundedManagerDecision} from '../apps/tigeriq-core/manager-json.mjs';

const valid=(summary='ok')=>JSON.stringify({status:'complete',summary,jobs:[]});
const resource=id=>({id,provider:id==='NV11'?'groq':'openrouter'});

describe('manager JSON parsing',()=>{
  it('strips only outer fence and preserves inner literal byte-for-byte',()=>{
    const literal="replace(/```json|```/gi,'')";
    const input='```json\n'+JSON.stringify({status:'complete',summary:literal,jobs:[]})+'\n```';
    expect(parseManagerJson(input).summary).toBe(literal);
  });
  it('salvages one valid JSON object wrapped in provider prose but rejects ambiguity',()=>{
    expect(parseManagerJson('Result follows:\n'+valid('wrapped')+'\nDone.').summary).toBe('wrapped');
    expect(()=>parseManagerJson(valid('one')+'\n'+valid('two'))).toThrow('MANAGER_JSON_AMBIGUOUS');
  });
  it('rejects invalid status and invalid jobs per status',()=>{
    expect(()=>parseManagerJson(JSON.stringify({status:'maybe',summary:'x',jobs:[]}))).toThrow('MANAGER_STATUS_INVALID');
    expect(()=>parseManagerJson(JSON.stringify({status:'continue',summary:'x',jobs:[]}))).toThrow('MANAGER_SCHEMA_INVALID');
    expect(()=>parseManagerJson(JSON.stringify({status:'continue',summary:'x',jobs:[{title:'t',prompt:'p'},{title:'t',prompt:'p'},{title:'t',prompt:'p'},{title:'t',prompt:'p'}]}))).toThrow('MANAGER_SCHEMA_INVALID');
    expect(()=>parseManagerJson(JSON.stringify({status:'complete',summary:'x',jobs:[{title:'t',prompt:'p'}]}))).toThrow('MANAGER_SCHEMA_INVALID');
    expect(()=>parseManagerJson(JSON.stringify({status:'blocked',summary:'x',jobs:[{title:'t',prompt:'p'}]}))).toThrow('MANAGER_SCHEMA_INVALID');
    expect(parseManagerJson(JSON.stringify({status:'complete',summary:'x',jobs:[]}))).toMatchObject({status:'complete',jobs:[]});
    expect(parseManagerJson(JSON.stringify({status:'continue',summary:'x',jobs:[{title:'t',prompt:'p'}]}))).toMatchObject({status:'continue',jobs:[{title:'t',prompt:'p'}]});
  });
  it('requests structured JSON only for supported manager transports',()=>{
    const prompt='You are TigerIQ AI Manager. Return ONLY JSON.';
    expect(managerResponseFormatForHost('api.groq.com',prompt)).toEqual({type:'json_object'});
    expect(managerResponseFormatForHost('openrouter.ai',prompt)).toEqual({type:'json_object'});
    expect(managerResponseFormatForHost('integrate.api.nvidia.com',prompt)).toEqual({type:'json_object'});
    expect(managerResponseFormatForHost('api.cloudflare.com',prompt)).toBeNull();
    expect(managerResponseFormatForHost('api.groq.com','ordinary job')).toBeNull();
  });
  it('builds a lean deterministic local-manager request',()=>{
    expect(managerLocalRequestBody('qwen3:4b','manager prompt')).toEqual({
      model:'qwen3:4b',
      prompt:'manager prompt',
      stream:false,
      think:false,
      format:'json',
      options:{temperature:0,num_ctx:4096,num_predict:512},
    });
  });
  it('reserves the final manager stage for local fallback',()=>{
    expect(managerShouldUseLocalFallback(0,2)).toBe(false);
    expect(managerShouldUseLocalFallback(1,2)).toBe(false);
    expect(managerShouldUseLocalFallback(2,2)).toBe(true);
    expect(managerShouldUseLocalFallback(3,2)).toBe(true);
  });
});

describe('bounded manager retry/failover',()=>{
  it('retries malformed output once on the same resource',async()=>{
    const acquired=[];const invoked=[];const retried=[];let calls=0;
    const result=await runBoundedManagerDecision({prompt:'p',acquire:async excluded=>{acquired.push([...excluded]);return resource('NV11');},invoke:async r=>{invoked.push(r.id);calls++;return calls===1?'not-json':valid('recovered');},onRetry:async r=>retried.push(r.id)});
    expect(result.decision.summary).toBe('recovered');expect(invoked).toEqual(['NV11','NV11']);expect(acquired).toHaveLength(1);expect(retried).toEqual(['NV11']);
  });
  it('fails over after two malformed outputs without unbounded looping',async()=>{
    const pool=[resource('NV11'),resource('NV13')];const invoked=[];const failed=[];let pick=0;
    const result=await runBoundedManagerDecision({prompt:'p',maxProviders:2,acquire:async excluded=>{expect(excluded).toEqual(pool.slice(0,pick).map(x=>x.id));return pool[pick++]||null;},invoke:async r=>{invoked.push(r.id);return r.id==='NV13'?valid('fallback-ok'):'bad';},onFailure:async r=>failed.push(r.id)});
    expect(result.decision.summary).toBe('fallback-ok');expect(invoked).toEqual(['NV11','NV11','NV13']);expect(failed).toEqual(['NV11']);
  });

  it('returns a terminal blocked decision when the bounded provider budget is exhausted',async()=>{
    const pool=[resource('NV11'),resource('NV13'),resource('NV15')];let pick=0,calls=0;
    const result=await runBoundedManagerDecision({prompt:'p',maxProviders:3,acquire:async()=>pool[pick++]||null,invoke:async()=>{calls++;return 'bad';}});
    expect(calls).toBe(6);
    expect(result.exhausted).toBe(true);
    expect(result.providerAttempts).toBe(3);
    expect(result.decision).toEqual({status:'blocked',summary:'manager decision exhausted after bounded retry/failover',jobs:[]});
  });

  it('does not retry provider or policy failures as manager-output errors',async()=>{
    let calls=0;const pool=[resource('NV11'),resource('NV13')];let pick=0;
    const result=await runBoundedManagerDecision({prompt:'p',maxProviders:2,acquire:async()=>pool[pick++]||null,invoke:async r=>{calls++;if(r.id==='NV11'){const e=new Error('HTTP_429');e.kind='rate_limit';throw e;}return valid('next-provider');}});
    expect(result.decision.summary).toBe('next-provider');expect(calls).toBe(2);
  });

  it('stops instead of failing over when resource failure policy is terminal',async()=>{
    let calls=0,pick=0;const pool=[resource('NV11'),resource('NV13')];
    const result=await runBoundedManagerDecision({prompt:'p',maxProviders:2,acquire:async()=>pool[pick++]||null,invoke:async()=>{calls++;const e=new Error('HTTP_401');e.kind='auth';throw e;},onFailure:async()=>({policy:{stop:true}})});
    expect(calls).toBe(1);
    expect(pick).toBe(1);
    expect(result.stopped).toBe(true);
    expect(result.exhausted).toBe(false);
    expect(result.providerAttempts).toBe(1);
    expect(result.decision).toEqual({status:'blocked',summary:'manager decision stopped by resource failure policy',jobs:[]});
  });
});
