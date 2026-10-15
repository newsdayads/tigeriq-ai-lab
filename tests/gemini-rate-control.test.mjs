import test from 'node:test';
import assert from 'node:assert';
import {createGeminiRateController,exponentialBackoffDelay,isGeminiRateLimitError,isGeminiDailyQuotaError,nextGeminiDailyResetUtc} from '../apps/shared/gemini-rate-control.mjs';

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

test('Gemini daily RPD 429 does not retry or call again before Pacific reset',async()=>{
  let now=Date.parse('2026-10-15T05:00:00Z'),calls=0;
  const reset='2026-10-15T07:00:00.000Z';
  assert.equal(nextGeminiDailyResetUtc(now),reset);
  const controller=createGeminiRateController({maxAttempts:4,nowFn:()=>now,sleepFn:async ms=>{now+=ms;}});
  const quotaError=Object.assign(new Error('HTTP_429'),{status:429,kind:'rate_limit',body:{error:{details:[{quotaId:'GenerateRequestsPerDayPerProjectPerModel-FreeTier'}]}}});
  assert.equal(isGeminiDailyQuotaError(quotaError),true);
  await assert.rejects(()=>controller.run(async()=>{calls++;throw quotaError;}),e=>e.geminiDailyQuota===true&&e.cooldownUntil===reset);
  await assert.rejects(()=>controller.run(async()=>{calls++;return 'forbidden';}),e=>e.message==='GEMINI_DAILY_QUOTA_WAIT'&&e.cooldownUntil===reset);
  assert.equal(calls,1,'no repeated paid-or-quota-consuming request during RPD block');
  now=Date.parse(reset)+1000;
  assert.equal(await controller.run(async()=>{calls++;return 'free-again';}),'free-again');
  assert.equal(calls,2);
});

test('Gemini Pacific quota reset handles DST and rejects generic minute-limit as daily',()=>{
  assert.equal(nextGeminiDailyResetUtc(Date.parse('2026-11-01T10:00:00Z')),'2026-11-02T08:00:00.000Z');
  const minute=Object.assign(new Error('HTTP_429'),{status:429,body:{error:{details:[{quotaId:'GenerateContentInputTokensPerMinutePerProjectPerModel'}]}}});
  assert.equal(isGeminiDailyQuotaError(minute),false);
  assert.equal(isGeminiDailyQuotaError({status:401,message:'RequestsPerDay'}),false);
});
