import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {completeRoster,normalizeRuntimeResources} from '../apps/tigeriq-core/workforce-registry.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const core=read('../apps/tigeriq-core/core.mjs');
const registry=read('../apps/tigeriq-core/workforce-registry.mjs');
const bridge=read('../apps/tigeriq-live-bridge/server.mjs');
const expected=new Map([
  ['NV06','PC Operator · OpenClaw'],
  ['NV08','Core AI Manager · Ollama Qwen3 8B'],
  ['NV09','Core AI Coder · Ollama Qwen3.6 27B'],
  ['NV10','Core API Doctor · Ollama Qwen3 4B'],
]);

test('all four approved labels match live Core resources, fallback roster, and live bridge',()=>{
  const coreNames=new Map([
    ['NV06',/resourceId:OPENCLAW_RESOURCE_ID,name:'([^']+)'/.exec(core)?.[1]],
    ['NV08',/R\(CORE_MANAGER_EMPLOYEE_ID,'([^']+)'/.exec(core)?.[1]],
    ['NV09',/R\(NV09_EMPLOYEE_ID,'([^']+)'/.exec(core)?.[1]],
    ['NV10',/R\(OLLAMA_EMPLOYEE_ID,'([^']+)'/.exec(core)?.[1]],
  ]);
  const roster=completeRoster(new Map([
    ...expected.entries().map(([employee_id,name])=>[employee_id,{employee_id,name,admin_state:'ACTIVE_CORE_RESOURCE'}]),
  ]));
  for(const [id,name] of expected){
    assert.equal(coreNames.get(id),name,id+' core');
    assert.equal(roster.find(x=>x.employee_id===id)?.name,name,id+' roster parser');
    assert.ok(registry.includes("name:'"+name+"'"),id+' fallback name');
    assert.ok(bridge.includes(id+":'"+name+"'"),id+' bridge fallback');
  }
  assert.match(bridge,/label:labels\[r\.employee_id\]\|\|r\.name\|\|r\.employee_id/);
});

test('renaming NV10 does not break stale NV02 Ollama identity reconciliation',()=>{
  const roster=completeRoster(new Map([
    ['NV02',{employee_id:'NV02',name:'ChatGPT Plus',admin_state:'AVAILABLE_MANUAL'}],
    ['NV10',{employee_id:'NV10',name:expected.get('NV10'),admin_state:'ACTIVE_CORE_RESOURCE'}],
  ]));
  const [projected]=normalizeRuntimeResources([
    {employee_id:'NV02',name:'Ollama',provider:'ollama',status:'IDLE'},
  ],roster);
  assert.equal(projected.employee_id,'NV10');
  assert.equal(projected.runtime_source_employee_id,'NV02');
  assert.equal(projected.identity_migrated,true);
  assert.match(registry,/roster\.has\('NV10'\)/);
});

test('display-name updates do not change roles, model tags, or resource IDs',()=>{
  assert.match(core,/NV08'|CORE_MANAGER_EMPLOYEE_ID = 'NV08'/);
  assert.match(core,/nv08Resource\.capabilities = \['manager'\]/);
  assert.match(core,/nv09Resource\.capabilities = \['coding_local'\]/);
  assert.match(core,/nv10Resource\.capabilities = \['general','reasoning','review',API_DOCTOR_CAPABILITY\]/);
  assert.match(core,/capabilities:\['pc_operator'\]/);
  assert.match(core,/CORE_MANAGER_MODEL = process\.env\.TIGERIQ_CORE_MANAGER_MODEL\?\.trim\(\) \|\| 'qwen3:8b'/);
  assert.match(core,/process\.env\.TIGERIQ_OLLAMA_MODEL \|\| 'qwen3:4b'/);
});
