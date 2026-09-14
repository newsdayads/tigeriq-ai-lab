import test from 'node:test';
import assert from 'node:assert';
import {createGeminiRateController,exponentialBackoffDelay,isGeminiRateLimitError} from '../apps/shared/gemini-rate-control.mjs';

test('Gemini rate controller enforces at least 4500ms between calls',async()=>{
  let now=0;const starts=[];const sleeps=[];
  const controller=createGeminiRateController({minIntervalMs:4500,maxAttempts:1,nowFn:()=>now,sleepFn:async ms=>{sleeps.push(ms);now+=ms;}});
  await controller.run(async()=>{starts.push(now);return 'a';});
  await controller.run(async()=>{starts.push(now);return 'b';});
  assert.deepStrictEqual(starts,[0,4500]);
  assert.deepStrictEqual(sleeps,[4500]);
});

test('Gemini 429 uses exponential backoff then succeeds',async()=>{
  let now=0;let calls=0;const sleeps=[];
  const controller=createGeminiRateController({minIntervalMs:4500,maxAttempts:4,backoffBaseMs:4500,nowFn:()=>now,sleepFn:async ms=>{sleeps.push(ms);now+=ms;}});
  const value=await controller.run(async()=>{calls++;if(calls<3){const e=new Error('HTTP_429 RESOURCE_EXHAUSTED');e.status=429;throw e;}return 'ok';});
  assert.strictEqual(value,'ok');
  assert.strictEqual(calls,3);
  assert.deepStrictEqual(sleeps,[4500,9000]);
});

test('Gemini 429 exhaustion is marked for outer failover',async()=>{
  let now=0;
  const controller=createGeminiRateController({minIntervalMs:4500,maxAttempts:2,backoffBaseMs:4500,nowFn:()=>now,sleepFn:async ms=>{now+=ms;}});
  await assert.rejects(()=>controller.run(async()=>{const e=new Error('RESOURCE_EXHAUSTED');e.status=429;throw e;}),e=>e.geminiRetryExhausted===true);
});
test('Gemini controller serializes concurrent calls with throttle',async()=>{
  let now=0;const starts=[];const sleeps=[];
  const controller=createGeminiRateController({minIntervalMs:4500,maxAttempts:1,nowFn:()=>now,sleepFn:async ms=>{sleeps.push(ms);now+=ms;}});
  await Promise.all([
    controller.run(async()=>{starts.push(now);return 'a';}),
    controller.run(async()=>{starts.push(now);return 'b';}),
    controller.run(async()=>{starts.push(now);return 'c';}),
  ]);
  assert.deepStrictEqual(starts,[0,4500,9000]);
  assert.deepStrictEqual(sleeps,[4500,4500]);
});

test('Gemini controller propagates non-rate-limit errors unchanged',async()=>{
  const controller=createGeminiRateController({maxAttempts:4});
  const original=new Error('AUTH_FAILURE');original.status=401;
  await assert.rejects(()=>controller.run(async()=>{throw original;}),e=>e===original&&e.geminiRetryExhausted!==true);
});
