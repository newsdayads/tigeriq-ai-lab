import { describe,expect,it,vi } from 'vitest';
import { createAnthropicHttpAdapter,createGeminiHttpAdapter,createOfficialHttpAdapter,createResponsesHttpAdapter } from '../packages/model-router/src/http-adapters.js';

describe('credential-safe provider HTTP adapters',()=>{
  it('calls OpenAI Responses-compatible APIs without putting credentials in the body',async()=>{
    const fetchImpl=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toBe('https://api.openai.com/v1/responses');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key');
      expect(String(init?.body)).not.toContain('test-key');
      expect(JSON.parse(String(init?.body))).toEqual({model:'gpt-test',input:'hello'});
      return new Response(JSON.stringify({output:[{content:[{type:'output_text',text:'answer'}]}]}),{status:200,headers:{'content-type':'application/json'}});
    }) as unknown as typeof fetch;
    const adapter=createResponsesHttpAdapter({provider:'openai',endpoint:'https://api.openai.com/v1/responses',apiKey:()=> 'test-key',fetchImpl});
    await expect(adapter.execute({provider:'openai',model:'gpt-test'},{prompt:'hello'})).resolves.toBe('answer');
  });

  it('uses Gemini generateContent and x-goog-api-key header',async()=>{
    const fetchImpl=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
      expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('gem-key');
      expect(String(init?.body)).not.toContain('gem-key');
      return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'gemini answer'}]}}]}),{status:200,headers:{'content-type':'application/json'}});
    }) as unknown as typeof fetch;
    const adapter=createGeminiHttpAdapter({apiKey:()=> 'gem-key',fetchImpl});
    await expect(adapter.execute({provider:'gemini',model:'gemini-test'},{prompt:'hello'})).resolves.toBe('gemini answer');
  });

  it('uses Anthropic Messages headers and text blocks',async()=>{
    const fetchImpl=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toBe('https://api.anthropic.com/v1/messages');
      const headers=new Headers(init?.headers);
      expect(headers.get('x-api-key')).toBe('anth-key');
      expect(headers.get('anthropic-version')).toBe('2023-06-01');
      expect(String(init?.body)).not.toContain('anth-key');
      return new Response(JSON.stringify({content:[{type:'text',text:'claude answer'}]}),{status:200,headers:{'content-type':'application/json'}});
    }) as unknown as typeof fetch;
    const adapter=createAnthropicHttpAdapter({apiKey:()=> 'anth-key',fetchImpl,maxTokens:1000});
    await expect(adapter.execute({provider:'anthropic',model:'claude-test'},{prompt:'hello'})).resolves.toBe('claude answer');
  });

  it('maps official provider endpoints but requires credentials only at invocation time',async()=>{
    const seen:string[]=[];
    const fetchImpl=vi.fn(async(input:RequestInfo|URL)=>{seen.push(String(input));return new Response(JSON.stringify({output_text:'ok'}),{status:200,headers:{'content-type':'application/json'}});}) as unknown as typeof fetch;
    const env=process.env;
    process.env={...env,DEEPSEEK_API_KEY:'d-key'};
    try{
      const adapter=createOfficialHttpAdapter({provider:'deepseek',apiKeyEnv:'DEEPSEEK_API_KEY'},fetchImpl);
      await expect(adapter.execute({provider:'deepseek',model:'deepseek-test'},{prompt:'hello'})).resolves.toBe('ok');
      expect(seen).toEqual(['https://api.deepseek.com/responses']);
    }finally{process.env=env;}
  });

  it('fails closed without a credential and never performs the network call',async()=>{
    const fetchImpl=vi.fn() as unknown as typeof fetch;
    const adapter=createResponsesHttpAdapter({provider:'xai',endpoint:'https://api.x.ai/v1/responses',apiKey:()=>undefined,fetchImpl});
    await expect(adapter.execute({provider:'xai',model:'grok-test'},{prompt:'hello'})).rejects.toThrow('MISSING_PROVIDER_CREDENTIAL');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not include provider response bodies in HTTP errors',async()=>{
    const fetchImpl=vi.fn(async()=>new Response('sensitive upstream body',{status:429})) as unknown as typeof fetch;
    const adapter=createResponsesHttpAdapter({provider:'openrouter',endpoint:'https://openrouter.ai/api/v1/responses',apiKey:()=> 'key',fetchImpl});
    await expect(adapter.execute({provider:'openrouter',model:'model'},{prompt:'hello'})).rejects.toThrow('PROVIDER_HTTP_429');
    try{await adapter.execute({provider:'openrouter',model:'model'},{prompt:'hello'});}catch(error){expect(String(error)).not.toContain('sensitive upstream body');}
  });
});
