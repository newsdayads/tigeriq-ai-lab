import { describe,expect,it,vi } from 'vitest';
import { isOllamaProbeRequest,runOllamaProbe } from './ollama-probe-adapter.mjs';

const probeInit={
  method:'POST',
  body:JSON.stringify({model:'qwen3:4b',messages:[{role:'user',content:'Return exactly TIGERIQ_RESOURCE_PROBE_NV02'}]})
};

describe('Ollama probe adapter',()=>{
  it('intercepts only the exact local probe shape',()=>{
    expect(isOllamaProbeRequest('http://127.0.0.1:11434/v1/chat/completions',probeInit)).toBe(true);
    expect(isOllamaProbeRequest('http://127.0.0.1:11434/v1/chat/completions',{...probeInit,body:JSON.stringify({model:'qwen3:4b',messages:[{role:'user',content:'normal work'}]})})).toBe(false);
  });

  it('uses non-thinking bounded generation and returns OpenAI-compatible content',async()=>{
    const nativeFetch=vi.fn(async(_url,init)=>{
      const body=JSON.parse(init.body);
      expect(body).toMatchObject({model:'qwen3:4b',stream:false,think:false,options:{temperature:0,num_predict:32}});
      expect(body.prompt).toBe('TIGERIQ_RESOURCE_PROBE_NV02');
      return new Response(JSON.stringify({response:'TIGERIQ_RESOURCE_PROBE_NV02'}),{status:200,headers:{'content-type':'application/json'}});
    });
    const res=await runOllamaProbe(nativeFetch,probeInit);
    const body=await res.json();
    expect(body.choices[0].message.content).toBe('TIGERIQ_RESOURCE_PROBE_NV02');
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });
});
