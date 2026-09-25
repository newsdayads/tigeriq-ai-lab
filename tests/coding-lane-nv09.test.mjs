import test from 'node:test';
import assert from 'node:assert';
import {
  configuredCodingResourceIds,
  invokeOllamaChat,
  normalizeLocalOllamaBaseUrl,
} from '../apps/tigeriq-coding-lane/coding-lane.mjs';

test('NV09 is registered as a Coding Lane resource without cloud credentials',()=>{
  assert.ok(configuredCodingResourceIds().includes('NV09'));
});

test('NV09 Ollama transport is loopback-only',()=>{
  assert.strictEqual(normalizeLocalOllamaBaseUrl('http://127.0.0.1:11434'),'http://127.0.0.1:11434');
  assert.strictEqual(normalizeLocalOllamaBaseUrl('http://localhost:11434'),'http://localhost:11434');
  assert.throws(()=>normalizeLocalOllamaBaseUrl('https://example.com'),/OLLAMA_LOOPBACK_ONLY/);
  assert.throws(()=>normalizeLocalOllamaBaseUrl('http://100.97.23.87:11434'),/OLLAMA_LOOPBACK_ONLY/);
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
  const out=await invokeOllamaChat('qwen3-coder:30b','Return exactly NV09_CORE_DIRECT_OK',{
    fetchImpl,
    baseUrl:'http://127.0.0.1:11434',
    timeoutMs:15000,
    maxTokens:64,
  });
  assert.strictEqual(out,'NV09_CORE_DIRECT_OK');
  assert.strictEqual(seen.url,'http://127.0.0.1:11434/v1/chat/completions');
  assert.deepStrictEqual(seen.init.headers,{'content-type':'application/json'});
  const body=JSON.parse(seen.init.body);
  assert.strictEqual(body.model,'qwen3-coder:30b');
  assert.strictEqual(body.max_tokens,64);
  assert.strictEqual(body.stream,false);
  assert.deepStrictEqual(body.messages,[{role:'user',content:'Return exactly NV09_CORE_DIRECT_OK'}]);
});
