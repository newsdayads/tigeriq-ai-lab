import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeNvInferenceRequest, publicNvInferenceResult } from '../apps/tigeriq-core/nv-inference-contract.mjs';

test('Core NV inference contract normalizes bounded routed request',()=>{
  assert.deepEqual(normalizeNvInferenceRequest({
    prompt:'write from verified facts',
    capability:'REVIEW',
    taskKind:'news_reviewer',
    maxAttempts:2,
    excludeResourceIds:['r1','r1','r2'],
    excludeProviders:['NVIDIA','nvidia','groq'],
  }),{
    prompt:'write from verified facts',
    capability:'review',
    taskKind:'news_reviewer',
    maxAttempts:2,
    excludeResourceIds:['r1','r2'],
    excludeProviders:['nvidia','groq'],
  });
});

test('Core NV inference contract rejects unbounded or unsafe inputs',()=>{
  assert.throws(()=>normalizeNvInferenceRequest({prompt:''}),/NV_INFERENCE_PROMPT_REQUIRED/);
  assert.throws(()=>normalizeNvInferenceRequest({prompt:'x',capability:'coding'}),/NV_INFERENCE_CAPABILITY_INVALID/);
  assert.throws(()=>normalizeNvInferenceRequest({prompt:'x',taskKind:'bad task'}),/NV_INFERENCE_TASK_KIND_INVALID/);
  assert.throws(()=>normalizeNvInferenceRequest({prompt:'x',maxAttempts:4}),/NV_INFERENCE_MAX_ATTEMPTS_INVALID/);
  assert.throws(()=>normalizeNvInferenceRequest({prompt:'x',excludeProviders:'groq'}),/NV_INFERENCE_EXCLUSION_LIST_INVALID/);
});

test('Core NV inference result exposes routed identity required for independent review',()=>{
  const result=publicNvInferenceResult({
    text:'{"pass":true}',
    resource:{id:'NV20',resourceId:'nvidia:model:default:core',provider:'nvidia',model:'model'},
    latencyMs:123,
    failures:[{employeeId:'NV11',resourceId:'groq:model:default:core',provider:'groq',kind:'rate_limit',message:'secret detail'}],
  });
  assert.equal(result.employeeId,'NV20');
  assert.equal(result.provider,'nvidia');
  assert.equal(result.resourceId,'nvidia:model:default:core');
  assert.equal(result.failures[0].kind,'rate_limit');
  assert.equal(Object.hasOwn(result.failures[0],'message'),false);
});

test('Core route is loopback/auth protected and forwards identity exclusions',()=>{
  const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  assert.match(source,/url\.pathname==='\/api\/nv-inference'/);
  assert.match(source,/!auth\(req\)&&!localSelf\(req\)/);
  assert.match(source,/excludedResourceIds/);
  assert.match(source,/excludedProviders/);
});


test('Core source has no literal escaped newline imports',()=>{
  const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/;\\nimport\s/);
});
