import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8').replaceAll('\r\n','\n');
const start=source.indexOf('async function invokeProvider(');
const close=source.indexOf('async function initDb(',start);
assert.ok(start>=0&&close>start,'canonical invokeProvider anchor is unique and complete');
const isolatedFunction=source.slice(start,close).trim();

const launcher=readFileSync(new URL('../scripts/tigeriq-core/run-core.ps1',import.meta.url),'utf8').replaceAll('\r\n','\n');
test('PC01 launcher explicitly activates LOCAL NV10 allowlisted model and opt-in adapter only',()=>{
  assert.match(launcher,/\$env:TIGERIQ_OLLAMA_MODEL='gemma3:4b'/);
  assert.match(launcher,/\$env:TIGERIQ_NV10_NATIVE_STRUCTURED='enabled'/);
  assert.match(launcher,/Clear-CoreEnvironment[\s\S]*'TIGERIQ_NV10_NATIVE_STRUCTURED'/);
  assert.match(launcher,/\$env:TIGERIQ_ALLOW_PAID_AI='false'/);
});


function harness({enabled='',model='gemma3:4b',profile='LOCAL',packet={packet_version:'EXECUTION_PACKET_V1'},nativeError=null}={}){
  const calls=[];
  const ctx={
    process:{env:{TIGERIQ_NV10_NATIVE_STRUCTURED:enabled}},
    OLLAMA_EMPLOYEE_ID:'NV10',NV09_EMPLOYEE_ID:'NV09',
    CORE_MANAGER_EMPLOYEE_ID:'NV08',OLLAMA_TIMEOUT_MS:90000,NV09_TIMEOUT_MS:240000,CORE_MANAGER_TIMEOUT_MS:150000,
    runBoundedInferenceNv09:async(_prompt,options)=>{calls.push({route:'nv09',options});return {text:'nv09'};},
    structuredExecutionSchema:packet=>({type:'object',packet}),
    // The atomic admission behavior is tested separately; this VM harness
    // isolates only native-vs-compatible NV10 request selection.
    pool:{},
    withPc01LocalInferenceSlot:async(_pool,run)=>run(),
    openAiCompat:async()=>{calls.push('compat');return 'COMPAT_RESULT'},
    invokeNativeStructuredExecution:async options=>{
      calls.push({route:'native',model:options.model,timeoutMs:options.timeoutMs,numPredict:options.numPredict,packet:options.packet});
      if(nativeError)throw nativeError;
      return {text:'NATIVE_ACCEPTED',gate:{pass:true,code:'EXECUTION_ACCEPTED'}};
    },
  };
  const fn=runInNewContext('('+isolatedFunction+')',ctx);
  return {
    calls,
    run:()=>fn({id:'NV10',provider:'ollama',model},'synthetic prompt',{profile,compiledPacket:packet}),
    runNv09:(compiledPacket=packet)=>fn({id:'NV09',provider:'ollama',model:'qwen3.5:9b'},'synthetic prompt',{profile,compiledPacket}),
  };
}
test('NV09 compiled packet gets bounded large context and exact execution schema',async()=>{
  const packet={packet_version:'EXECUTION_PACKET_V1',task_id:'SYNTH'};
  const h=harness({packet});
  assert.equal(await h.runNv09(),'nv09');
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].route,'nv09');
  assert.equal(h.calls[0].options.numCtx,4096);
  assert.equal(h.calls[0].options.numPredict,256);
  assert.equal(h.calls[0].options.maxPromptChars,12000);
  assert.deepEqual(h.calls[0].options.format,{type:'object',packet});
});
test('NV09 generic request keeps prior small bounded defaults',async()=>{
  const h=harness({packet:null});
  assert.equal(await h.runNv09(null),'nv09');
  assert.equal(h.calls[0].options.numCtx,1024);
  assert.equal(h.calls[0].options.numPredict,96);
  assert.equal(h.calls[0].options.maxPromptChars,4000);
  assert.equal('format' in h.calls[0].options,false);
});

test('production default disabled: no new native route',async()=>{
  const h=harness();assert.equal(await h.run(),'COMPAT_RESULT');assert.deepEqual(h.calls,['compat']);
});
test('explicit enabled plus exact NV10 model, LOCAL and compiled packet invokes native',async()=>{
  const packet={packet_version:'EXECUTION_PACKET_V1',task_id:'SYNTH'};
  const h=harness({enabled:'enabled',packet});
  assert.equal(await h.run(),'NATIVE_ACCEPTED');assert.equal(h.calls.length,1);
  assert.deepEqual(h.calls[0].packet,packet);
  assert.equal(h.calls[0].model,'gemma3:4b');
  assert.equal(h.calls[0].timeoutMs,85000);assert.equal(h.calls[0].numPredict,512);
});
test('other model tags do not silently use another model',async()=>{
  const h=harness({enabled:'enabled',model:'qwen3:4b'});
  assert.equal(await h.run(),'COMPAT_RESULT');assert.deepEqual(h.calls,['compat']);
});
test('AUTO is not eligible for native LOCAL-only route',async()=>{
  const h=harness({enabled:'enabled',profile:'AUTO'});
  assert.equal(await h.run(),'COMPAT_RESULT');assert.deepEqual(h.calls,['compat']);
});
test('packet must be present, no implicit compiled classification',async()=>{
  const h=harness({enabled:'enabled',packet:null});
  assert.equal(await h.run(),'COMPAT_RESULT');assert.deepEqual(h.calls,['compat']);
});
test('native source/gate errors propagate: no silent downgrade to compatibility provider',async()=>{
  const bad=Object.assign(new Error('EXECUTION_ACCEPTANCE_MISSING'),{kind:'invalid_response'});
  const h=harness({enabled:'enabled',nativeError:bad});
  await assert.rejects(h.run(),/EXECUTION_ACCEPTANCE_MISSING/);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].route,'native');
});
test('all native provider invocations are routed by compiled job packet from Core',()=>{
  assert.equal(source.split('employeeAllowlist,validateText,compiledPacket});').length-1,2);
  assert.equal(source.split('invokeProvider(r,prompt,{profile,compiledPacket:options.compiledPacket||null})').length-1,2);
});
