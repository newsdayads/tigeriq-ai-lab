import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  HEALTH_STATES,
  NV09_EMPLOYEE_ID,
  NV09_MODEL,
  getRegisteredModels,
  nv09ModelAvailability,
  registerNv09,
  runBoundedInferenceNv09
} from '../apps/tigeriq-core/registry.mjs';

test('registers NV09 idempotently as qwen3-coder:30b', () => {
  const a=registerNv09(),b=registerNv09();
  assert.strictEqual(a,b);
  assert.strictEqual(a.employee_id,NV09_EMPLOYEE_ID);
  assert.strictEqual(a.model,NV09_MODEL);
  assert.strictEqual(a.endpoint,'http://127.0.0.1:11434');
  assert.strictEqual(a.health,HEALTH_STATES.IDLE_ON_DEMAND);
  assert.strictEqual(getRegisteredModels().filter(x=>x.employee_id==='NV09').length,1);
});

test('availability verifies the exact NV09 model and digest without inference', async()=>{
  const fake=async()=>({ok:true,status:200,json:async()=>({models:[{name:'qwen3-coder:30b',digest:'abc123',size:18556700761}]})});
  const out=await nv09ModelAvailability(fake);
  assert.deepStrictEqual({ok:out.ok,employeeId:out.employeeId,model:out.model,digest:out.digest,size:out.size},{ok:true,employeeId:'NV09',model:'qwen3-coder:30b',digest:'abc123',size:18556700761});
});

test('bounded inference sends small deterministic Ollama request and returns telemetry', async()=>{
  let request;
  const fake=async(url,init)=>{
    request={url,init,body:JSON.parse(init.body)};
    return {ok:true,status:200,json:async()=>({model:'qwen3-coder:30b',response:'NV09_CORE_CANARY_OK',done:true,load_duration:11,eval_duration:22,eval_count:3})};
  };
  const out=await runBoundedInferenceNv09('safe coding canary',{fetchImpl:fake,timeoutMs:2000,numCtx:512,numPredict:12,keepAlive:'5s'});
  assert.strictEqual(request.url,'http://127.0.0.1:11434/api/generate');
  assert.strictEqual(request.body.model,'qwen3-coder:30b');
  assert.strictEqual(request.body.stream,false);
  assert.strictEqual(request.body.think,false);
  assert.strictEqual(request.body.options.num_ctx,512);
  assert.strictEqual(request.body.options.num_predict,12);
  assert.strictEqual(out.text,'NV09_CORE_CANARY_OK');
  assert.strictEqual(out.evalCount,3);
});

test('bounded inference preserves real Ollama 5xx evidence', async()=>{
  const fake=async()=>({ok:false,status:500,text:async()=>JSON.stringify({error:'llama-server binary not found'})});
  await assert.rejects(
    ()=>runBoundedInferenceNv09('safe',{fetchImpl:fake,timeoutMs:2000}),
    /NV09_INFERENCE_HTTP_500:llama-server binary not found/
  );
});

test('Core wires NV09 as isolated on-demand local coder without changing NV10',()=>{
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  assert.match(core,/const NV09_TIMEOUT_MS/);
  assert.match(core,/R\(NV09_EMPLOYEE_ID,'Qwen3-Coder Local','ollama',NV09_MODEL/);
  assert.match(core,/nv09Resource\.capabilities = \['coding_local'\]/);
  assert.match(core,/nv09Resource\.runtimeBinding = 'ollama_on_demand'/);
  assert.match(core,/const resources = \[\s*nv09Resource,\s*nv10Resource,/);
  assert.match(core,/employee_id not in \(\$1,\$2\)/);
  assert.match(core,/if\(row\.runtime_binding==='ollama_on_demand'\)continue/);
  assert.match(core,/url\.pathname==='\/api\/nv09\/canary'/);
  assert.match(core,/event\('NV09_CANARY_PASS'/);
  assert.match(core,/if\(r\.work_state==='ON_DEMAND'\) return 'ON_DEMAND'/);
  assert.match(core,/const nv10Resource = R\(OLLAMA_EMPLOYEE_ID,'Ollama','ollama'/);
  assert.match(core,/nv10Resource\.capabilities = \['general','reasoning','review',API_DOCTOR_CAPABILITY\]/);
});
