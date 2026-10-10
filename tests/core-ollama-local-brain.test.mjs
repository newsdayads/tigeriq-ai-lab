import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runBoundedManagerDecision,managerLocalRequestBody } from '../apps/tigeriq-core/manager-json.mjs';

const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
const manager=source.slice(source.indexOf('async function callManagerDecision('),source.indexOf('async function reconcileAutonomousHandoff('));
const claimJob=source.slice(source.indexOf('async function claimJob('),source.indexOf('async function callManagerDecision('));
const queueProjection=source.slice(source.indexOf('const employeeAllowlist=taskKind==='),source.indexOf('const reviewerResourceIds=capability===',source.indexOf('const employeeAllowlist=taskKind===')));

test('Core Manager always reserves NV10 Ollama locally without visiting cloud NV API',()=>{
  assert.ok(manager.startsWith('async function callManagerDecision('));
  assert.match(manager,/maxProviders:1/);
  assert.match(manager,/x\.id===OLLAMA_EMPLOYEE_ID&&x\.provider==='ollama'/);
  assert.match(manager,/profile:'LOCAL',taskKind:'manager',preferredEmployeeId:OLLAMA_EMPLOYEE_ID/);
  assert.match(manager,/employeeAllowlist:CORE_LOCAL_BRAIN_EMPLOYEES/);
  assert.match(manager,/const nonLocalIds=resources\.filter\(x=>x\.resourceId!==localResource\.resourceId\)/);
  assert.doesNotMatch(manager,/managerShouldUseLocalFallback|profile:'AUTO'|maxProviders:3|cloudBudget/);
});

test('GitHub read-only API work uses same local worker in execution and queue eligibility',()=>{
  assert.match(claimJob,/employeeAllowlist=j\.kind==='github_api_autowork'\?CORE_LOCAL_BRAIN_EMPLOYEES:stabilityAllowlist/);
  assert.match(claimJob,/profile:j\.kind==='github_api_autowork'\?'LOCAL':\(j\.routing_profile\|\|'AUTO'\)/);
  assert.match(queueProjection,/new Set\(CORE_LOCAL_BRAIN_EMPLOYEES\)/);
  assert.doesNotMatch(queueProjection,/NV11|NV12|NV13|NV14|NV15|NV16|NV17|NV18|NV19|NV20/);
});

test('bounded local manager call accepts valid structured result without any cloud calls',async()=>{
  let localInvoked=0,cloudInvoked=0;
  const result=await runBoundedManagerDecision({
    prompt:'You are TigerIQ AI Manager. Return JSON.',
    maxProviders:1,
    acquire:async excluded=>excluded.length?null:{id:'NV10',provider:'ollama'},
    invoke:async resource=>{
      if(resource.provider!=='ollama'){cloudInvoked++;throw Error('CLOUD_FORBIDDEN');}
      localInvoked++;
      return '{"status":"continue","summary":"local plan","jobs":[{"title":"audit","prompt":"inspect authorized input","capability":"reasoning","acceptance":["evidence"],"evidence_required":["source"]}]}';
    },
  });
  assert.equal(result.resource.id,'NV10');
  assert.equal(result.decision.jobs.length,1);
  assert.equal(localInvoked,1);
  assert.equal(cloudInvoked,0);
});

test('local unavailable exits bounded without cloud fallback or fake completion',async()=>{
  let invoked=0;
  const result=await runBoundedManagerDecision({
    prompt:'You are TigerIQ AI Manager. Return JSON.',
    maxProviders:1,
    acquire:async()=>null,
    invoke:async()=>{invoked++;throw Error('SHOULD_NOT_RUN');},
  });
  assert.equal(result.exhausted,true);
  assert.equal(result.resource,null);
  assert.equal(result.decision.status,'blocked');
  assert.equal(invoked,0);
});

test('local model request uses bounded JSON response and zero thinking budget',()=>{
  const packet=managerLocalRequestBody('qwen3:4b','You are TigerIQ AI Manager.');
  assert.equal(packet.model,'qwen3:4b');
  assert.equal(packet.format,'json');
  assert.equal(packet.think,false);
  assert.equal(packet.stream,false);
  assert.ok(packet.options.num_predict<=512);
});
