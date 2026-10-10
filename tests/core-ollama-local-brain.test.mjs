import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runBoundedManagerDecision,managerLocalRequestBody } from '../apps/tigeriq-core/manager-json.mjs';
import { scoreResource } from '../apps/tigeriq-core/smart-router.mjs';
import { completeRoster } from '../apps/tigeriq-core/workforce-registry.mjs';

const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
const manager=source.slice(source.indexOf('async function callManagerDecision('),source.indexOf('async function reconcileAutonomousHandoff('));
const claimJob=source.slice(source.indexOf('async function claimJob('),source.indexOf('async function callManagerDecision('));
const queueProjection=source.slice(source.indexOf('const employeeAllowlist=taskKind==='),source.indexOf('const reviewerResourceIds=capability===',source.indexOf('const employeeAllowlist=taskKind===')));

test('Core Manager reserves dedicated NV08 Ollama without visiting cloud NV API',()=>{
  assert.ok(manager.startsWith('async function callManagerDecision('));
  assert.match(manager,/maxProviders:1/);
  assert.match(manager,/x\.id===CORE_MANAGER_EMPLOYEE_ID&&x\.provider==='ollama'/);
  assert.match(manager,/profile:'LOCAL',taskKind:'manager',preferredEmployeeId:CORE_MANAGER_EMPLOYEE_ID/);
  assert.match(manager,/employeeAllowlist:\[CORE_MANAGER_EMPLOYEE_ID\]/);
  assert.match(manager,/const otherResourceIds=resources\.filter\(x=>x\.resourceId!==localResource\.resourceId\)/);
  assert.match(manager,/claimResource\('manager',jobId,otherResourceIds/);
  assert.match(manager,/invokeLocalManager\(nextPrompt,r\.model\)/);
  assert.doesNotMatch(manager,/managerShouldUseLocalFallback|profile:'AUTO'|maxProviders:3|cloudBudget/);
});

test('GitHub read-only API work uses same local worker in execution and queue eligibility',()=>{
  assert.match(claimJob,/employeeAllowlist=j\.kind==='github_api_autowork'\?CORE_LOCAL_AUTOWORK_EMPLOYEES:stabilityAllowlist/);
  assert.match(claimJob,/profile:j\.kind==='github_api_autowork'\?'LOCAL':\(j\.routing_profile\|\|'AUTO'\)/);
  assert.match(queueProjection,/new Set\(CORE_LOCAL_AUTOWORK_EMPLOYEES\)/);
  assert.doesNotMatch(queueProjection,/NV11|NV12|NV13|NV14|NV15|NV16|NV17|NV18|NV19|NV20/);
});

test('bounded local manager call accepts valid structured result without any cloud calls',async()=>{
  let localInvoked=0,cloudInvoked=0;
  const result=await runBoundedManagerDecision({
    prompt:'You are TigerIQ AI Manager. Return JSON.',
    maxProviders:1,
    acquire:async excluded=>excluded.length?null:{id:'NV08',provider:'ollama'},
    invoke:async resource=>{
      if(resource.provider!=='ollama'){cloudInvoked++;throw Error('CLOUD_FORBIDDEN');}
      localInvoked++;
      return '{"status":"continue","summary":"local plan","jobs":[{"title":"audit","prompt":"inspect authorized input","capability":"reasoning","acceptance":["evidence"],"evidence_required":["source"]}]}';
    },
  });
  assert.equal(result.resource.id,'NV08');
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
  const packet=managerLocalRequestBody('qwen3:8b','You are TigerIQ AI Manager.');
  assert.equal(packet.model,'qwen3:8b');
  assert.equal(packet.format,'json');
  assert.equal(packet.think,false);
  assert.equal(packet.stream,false);
  assert.ok(packet.options.num_predict<=512);
});

test('NV08 is manager-only and cannot receive general/review/coding work',()=>{
  assert.match(source,/nv08Resource\.capabilities = \['manager'\]/);
  assert.match(source,/nv08Resource\.accountBinding = 'nv08-manager'/);
  assert.match(source,/createResourceId\('ollama',CORE_MANAGER_MODEL,nv08Resource\.accountBinding,'core'\)/);
  assert.match(source,/if\(capability==='manager'&&\(taskKind!=='manager'\|\|!String\(jobId\)\.startsWith\('MGR-'\)\)\)return null/);
  const nv08={
    resource_id:'res:ollama:qwen3-8b:nv08-manager:core',employee_id:'NV08',
    provider:'ollama',model:'qwen3:8b',capabilities:['manager'],
    credential_state:'LOCAL',health_state:'ONLINE',cost_tier:'LOCAL',
    rank:85,quota_state:{known:false,usable:true},
  };
  assert.equal(scoreResource(nv08,{profile:'LOCAL',capability:'manager'}).eligible,true);
  for(const capability of ['general','reasoning','review','coding','api_doctor']){
    assert.equal(scoreResource(nv08,{profile:'LOCAL',capability}).eligible,false,capability);
  }
});

test('NV08 and NV10 have distinct IDs, NV08 is no longer retired in roster',()=>{
  assert.match(source,/CORE_MANAGER_EMPLOYEE_ID = 'NV08'/);
  assert.match(source,/OLLAMA_EMPLOYEE_ID = 'NV10'/);
  const roster=completeRoster(new Map([
    ['NV08',{employee_id:'NV08',name:'Core AI Manager · Ollama Qwen3 8B',admin_state:'ACTIVE_CORE_RESOURCE'}],
    ['NV10',{employee_id:'NV10',name:'Core API Doctor · Ollama Qwen3 4B',admin_state:'ACTIVE_CORE_RESOURCE'}],
  ]));
  assert.equal(roster.find(x=>x.employee_id==='NV08').retired,false);
  assert.equal(roster.find(x=>x.employee_id==='NV10').retired,false);
});
