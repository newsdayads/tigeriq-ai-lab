import { describe,expect,it } from 'vitest';
import { parseAndValidateRegistries,parseProviderRegistry } from '../apps/ai-gateway/src/registry.js';

describe('AI registries',()=>{
  it('loads provider/model/employee registries as one validated graph',()=>{
    const result=parseAndValidateRegistries({
      providers:{version:1,providers:[{providerId:'ollama',kind:'local',enabled:true,healthy:true,costClass:'free',maxConcurrency:2}]},
      models:{version:1,models:[{modelId:'qwen3:8b',providerId:'ollama',enabled:true,capabilities:['reasoning','coding'],quality:70,speed:80,contextTokens:4096,costWeight:0}]},
      employees:{version:1,employees:[{employeeId:'coder-01',role:'coder',enabled:true,requiredCapabilities:['coding'],preferredModels:['qwen3:8b']}]}
    });
    expect(result.providers[0].providerId).toBe('ollama');
    expect(result.models[0].modelId).toBe('qwen3:8b');
    expect(result.employees[0].employeeId).toBe('coder-01');
  });

  it('keeps external providers disabled until onboarding evidence changes registry state',()=>{
    const providers=parseProviderRegistry({version:1,providers:[{providerId:'openai',kind:'external',enabled:false,healthy:false,costClass:'paid',maxConcurrency:4,secretRef:'env:OPENAI_API_KEY'}]});
    expect(providers[0]).toMatchObject({enabled:false,healthy:false,providerId:'openai'});
  });

  it('rejects a model referencing an unknown provider',()=>{
    expect(()=>parseAndValidateRegistries({providers:{version:1,providers:[]},models:{version:1,models:[{modelId:'m1',providerId:'missing',enabled:true,capabilities:['coding'],quality:1,speed:1,contextTokens:4096,costWeight:0}]},employees:{version:1,employees:[]}})).toThrow('INVALID_OR_DUPLICATE_MODEL');
  });
});
