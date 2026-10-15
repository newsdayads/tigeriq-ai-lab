import test from 'node:test';
import assert from 'node:assert';
process.env.NODE_ENV='test';
const {
  configuredCodingResourceIds,
  invokeOllamaChat,
  invokeNv09NativeCoder,
  invokeCodingOllamaResource,
  normalizeLocalOllamaBaseUrl,
  selectCodingWorker,
}=await import('../apps/tigeriq-coding-lane/coding-lane.mjs');

test('NV09 is registered as a Coding Lane resource without cloud credentials',()=>{
  assert.ok(configuredCodingResourceIds().includes('NV09'));
});

test('NV09 Ollama transport is loopback-only',()=>{
  assert.strictEqual(normalizeLocalOllamaBaseUrl('http://127.0.0.1:11434'),'http://127.0.0.1:11434');
  assert.strictEqual(normalizeLocalOllamaBaseUrl('http://localhost:11434'),'http://localhost:11434');
  assert.throws(()=>normalizeLocalOllamaBaseUrl('https://example.com'),/OLLAMA_LOOPBACK_ONLY/);
  assert.throws(()=>normalizeLocalOllamaBaseUrl('http://100.97.23.87:11434'),/OLLAMA_LOOPBACK_ONLY/);
});

test('NV09 defaults to dedicated GPU Ollama endpoint 11435',async()=>{
  let seen=null;
  const fetchImpl=async(url,init)=>{
    seen={url,init};
    return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:'OK'}}]})};
  };
  const out=await invokeOllamaChat('qwen3.5:9b','Return OK',{fetchImpl,timeoutMs:15000,maxTokens:8});
  assert.strictEqual(out,'OK');
  assert.strictEqual(seen.url,'http://127.0.0.1:11435/v1/chat/completions');
});

test('NV09 Ollama transport is bounded and sends no credential header',async()=>{
  let seen=null;
  const fetchImpl=async(url,init)=>{
    seen={url,init};
    return {
      ok:true,
      status:200,
      text:async()=>JSON.stringify({choices:[{message:{content:'NV09_CORE_DIRECT_OK'}}]}),
    };
  };
  const out=await invokeOllamaChat('qwen3.5:9b','Return exactly NV09_CORE_DIRECT_OK',{
    fetchImpl,
    baseUrl:'http://127.0.0.1:11434',
    timeoutMs:15000,
    maxTokens:64,
  });
  assert.strictEqual(out,'NV09_CORE_DIRECT_OK');
  assert.strictEqual(seen.url,'http://127.0.0.1:11434/v1/chat/completions');
  assert.deepStrictEqual(seen.init.headers,{'content-type':'application/json'});
  const body=JSON.parse(seen.init.body);
  assert.strictEqual(body.model,'qwen3.5:9b');
  assert.strictEqual(body.max_tokens,64);
  assert.strictEqual(body.stream,false);
  assert.deepStrictEqual(body.messages,[{role:'user',content:'Return exactly NV09_CORE_DIRECT_OK'}]);
});


test('NV09 native worker uses 11435 with think:false, bounded JSON and no credential headers',async()=>{
  const calls=[];
  const fetchImpl=async(url,init)=>{
    calls.push({url,init});
    return {ok:true,status:200,text:async()=>JSON.stringify({message:{content:'{"summary":"fixed","changes":[{"path":"src/math.js","content":"export const n=2;"}]}'}})};
  };
  const out=await invokeCodingOllamaResource({id:'NV09',provider:'ollama',model:'qwen3.5:9b'},'Update code',{
    fetchImpl,workerUrl:'http://127.0.0.1:11435',managerUrl:'http://127.0.0.1:11434',maxTokens:128,
  });
  const response=JSON.parse(out);
  assert.deepStrictEqual(response.changes,[{path:'src/math.js',content:'export const n=2;'}]);
  assert.strictEqual(calls.length,1);
  assert.strictEqual(calls[0].url,'http://127.0.0.1:11435/api/chat');
  const body=JSON.parse(calls[0].init.body);
  assert.strictEqual(body.model,'qwen3.5:9b');
  assert.strictEqual(body.think,false);
  assert.strictEqual(body.stream,false);
  assert.strictEqual(body.keep_alive,'0s');
  assert.deepStrictEqual(body.options,{temperature:0,num_ctx:8192,num_predict:128});
  assert.deepStrictEqual(calls[0].init.headers,{'content-type':'application/json'});
});

test('NV09 native worker rejects reasoning-only EMPTY_RESPONSE without rerouting NV08/NV10',async()=>{
  const urls=[];
  const fetchImpl=async(url)=>{
    urls.push(url);
    return {ok:true,status:200,text:async()=>JSON.stringify({message:{content:'',thinking:'internal'}})};
  };
  await assert.rejects(invokeNv09NativeCoder('qwen3.5:9b','code',{fetchImpl,baseUrl:'http://127.0.0.1:11435'}),/EMPTY_RESPONSE/);
  assert.deepStrictEqual(urls,['http://127.0.0.1:11435/api/chat']);
});

test('NV09 is preferred for untargeted Coding Lane implementation when healthy and available',()=>{
  const nv11={id:'NV11'},nv09={id:'NV09'},nv12={id:'NV12'};
  let fallbackCalls=0;
  const chosen=selectCodingWorker([nv11,nv09,nv12],'',()=>{fallbackCalls++;return nv11});
  assert.strictEqual(chosen,nv09);
  assert.strictEqual(fallbackCalls,0);
});

test('explicit coding target takes precedence over NV09 preference',()=>{
  const nv09={id:'NV09'},nv12={id:'NV12'};
  assert.strictEqual(selectCodingWorker([nv09,nv12],'NV12',()=>nv09),nv12);
});

test('untargeted coding falls back when NV09 is unavailable',()=>{
  const nv11={id:'NV11'},nv12={id:'NV12'};
  assert.strictEqual(selectCodingWorker([nv11,nv12],'',()=>nv12),nv12);
});

test('explicit NV09 target fails closed when NV09 is unavailable',()=>{
  const nv11={id:'NV11'};
  assert.strictEqual(selectCodingWorker([nv11],'NV09',()=>nv11),null);
});
