import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {planContinuousVerifyRecovery,CONTINUOUS_VERIFY_RECOVERY_EVENT_LIMIT}
  from '../apps/tigeriq-core/continuous-verify-recovery.mjs';
import {createContinuousVerifyPendingQueue} from '../apps/tigeriq-core/continuous-verify.mjs';

const now=Date.parse('2026-10-23T01:00:00Z');
const stamp='2026-10-23T00:59:00Z';
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40);
const push=(sha)=>({kind:'GITHUB_MAIN_PUSH',key:'github-main:'+sha,sourceSha:sha});
const rec=(seq,type,data,ts=stamp)=>({seq,type,data,ts});

describe('GH-5176 persisted Continuous Verify crash recovery',()=>{
  it('restores authenticated relevant main push even if crash preceded async QUEUED receipt',()=>{
    const rows=[rec(12,'GITHUB_EVENT_RECEIVED',{
      deliveryId:'run-verified',continuousVerifyTrigger:push(A),
    })];
    expect(planContinuousVerifyRecovery(rows,{nowMs:now})).toEqual([
      {...push(A),trigger:true,attempt:0},
    ]);
    const q=createContinuousVerifyPendingQueue();
    expect(q.enqueue(planContinuousVerifyRecovery(rows,{nowMs:now})[0]).accepted).toBe(true);
    expect(q.take().key).toBe('github-main:'+A);
  });

  it('keeps distinct durable QUEUED keys in oldest-first order and dedupes repeated receipts',()=>{
    const rows=[
      rec(40,'CONTINUOUS_VERIFY_TRIGGER_QUEUED',push(C)),
      rec(30,'CONTINUOUS_VERIFY_TRIGGER_QUEUED',push(B)),
      rec(10,'CONTINUOUS_VERIFY_TRIGGER_QUEUED',push(A)),
      rec(31,'GITHUB_EVENT_RECEIVED',{continuousVerifyTrigger:push(B)}),
      rec(9,'GITHUB_EVENT_RECEIVED',{continuousVerifyTrigger:push(A)}),
    ];
    expect(planContinuousVerifyRecovery(rows,{nowMs:now}).map(x=>x.key)).toEqual([
      'github-main:'+A,'github-main:'+B,'github-main:'+C,
    ]);
  });

  it('fails closed for terminal success, exhausted failure, retries an interrupted first failure once',()=>{
    const rows=[
      rec(1,'CONTINUOUS_VERIFY_TRIGGER_QUEUED',push(A)),
      rec(2,'CONTINUOUS_VERIFY_RUN',{key:'github-main:'+A}),
      rec(3,'CONTINUOUS_VERIFY_TRIGGER_QUEUED',push(B)),
      rec(4,'CONTINUOUS_VERIFY_RUN_FAILED',{key:'github-main:'+B,attempt:1}),
      rec(5,'CONTINUOUS_VERIFY_TRIGGER_QUEUED',push(C)),
      rec(6,'CONTINUOUS_VERIFY_RUN_FAILED',{key:'github-main:'+C,attempt:0}),
    ];
    expect(planContinuousVerifyRecovery(rows,{nowMs:now})).toEqual([
      {...push(C),trigger:true,attempt:1},
    ]);
    expect(planContinuousVerifyRecovery([
      ...rows,rec(7,'CONTINUOUS_VERIFY_RUN',{key:'github-main:'+C})
    ],{nowMs:now})).toEqual([]);
  });

  it('rejects unqualified GitHub events, unrelated files, forged keys and mismatched SHA',()=>{
    const rows=[
      rec(1,'GITHUB_EVENT_RECEIVED',{key:'github-main:'+A,sourceSha:A}),
      rec(2,'GITHUB_EVENT_RECEIVED',{continuousVerifyTrigger:{...push(A),sourceSha:B}}),
      rec(3,'CONTINUOUS_VERIFY_TRIGGER_QUEUED',{...push(A),key:'github-main:fake'}),
      rec(4,'CONTINUOUS_VERIFY_TRIGGER_QUEUED',{...push(A),kind:'UNTRUSTED_EVENT'}),
      rec(5,'CONTINUOUS_VERIFY_TRIGGER_QUEUED',{...push(A),key:'runtime:'+A}),
      rec(6,'GITHUB_EVENT_RECEIVED',{continuousVerifyTrigger:{...push(A),kind:'GITHUB_UNRELATED'}}),
    ];
    expect(planContinuousVerifyRecovery(rows,{nowMs:now})).toEqual([]);
  });

  it('fails closed for runtime SHA receipts missing or contradicting currentSha',()=>{
    const runtimeKey='runtime:'+A;
    const runtime=(data,type='CONTINUOUS_VERIFY_TRIGGER_QUEUED')=>rec(1,type,data);
    const valid={kind:'RUNTIME_SHA_CHANGE',key:runtimeKey,currentSha:A};
    expect(planContinuousVerifyRecovery([runtime(valid)],{nowMs:now})).toEqual([
      {trigger:true,kind:'RUNTIME_SHA_CHANGE',key:runtimeKey,currentSha:A,attempt:0},
    ]);
    for(const invalid of [
      {kind:'RUNTIME_SHA_CHANGE',key:runtimeKey},
      {kind:'RUNTIME_SHA_CHANGE',key:runtimeKey,currentSha:null},
      {kind:'RUNTIME_SHA_CHANGE',key:runtimeKey,currentSha:''},
      {kind:'RUNTIME_SHA_CHANGE',key:runtimeKey,currentSha:B},
    ]){
      expect(planContinuousVerifyRecovery([runtime(invalid)],{nowMs:now})).toEqual([]);
    }
    // A GitHub receipt cannot smuggle an unrelated runtime trigger either.
    expect(planContinuousVerifyRecovery([runtime({continuousVerifyTrigger:valid},
      'GITHUB_EVENT_RECEIVED')],{nowMs:now})).toEqual([]);
  });

  it('bounds recovery to recent receipts, caps batch and supports verified runtime triggers',()=>{
    const recent=[
      rec(1,'CONTINUOUS_VERIFY_TRIGGER_QUEUED',push(A),'2026-10-21T00:00:00Z'),
      rec(2,'CONTINUOUS_VERIFY_TRIGGER_QUEUED',push(B)),
      rec(3,'CONTINUOUS_VERIFY_TRIGGER_QUEUED',push(C)),
      rec(4,'CONTINUOUS_VERIFY_TRIGGER_QUEUED',{kind:'RUNTIME_SHA_CHANGE',key:'runtime:'+A,currentSha:A}),
    ];
    expect(planContinuousVerifyRecovery(recent,{nowMs:now,batchLimit:2}).map(x=>x.key))
      .toEqual(['github-main:'+B,'github-main:'+C]);
    expect(planContinuousVerifyRecovery(recent,{nowMs:now}).map(x=>x.key))
      .toEqual(['github-main:'+B,'github-main:'+C,'runtime:'+A]);
    expect(CONTINUOUS_VERIFY_RECOVERY_EVENT_LIMIT).toBeLessThanOrEqual(1500);
  });

  it('binds admission to OIDC receipt transaction and reuses the existing Core main loop',()=>{
    const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    const endpoint=source.slice(source.indexOf("url.pathname==='/api/github-event'"),
      source.indexOf("url.pathname==='/api/ui-assignment'"));
    expect(endpoint).toContain('verifyGithubActionsOidc');
    expect(endpoint).toContain('const durableVerifyTrigger=githubContinuousVerifyTrigger');
    expect(endpoint).toContain('continuousVerifyTrigger:{');
    expect(endpoint.indexOf('continuousVerifyTrigger:{')).toBeLessThan(
      endpoint.indexOf("await client.query('commit')"));
    expect(source).toContain('async function recoverPersistedContinuousVerify()');
    expect(source).toContain("CONTINUOUS_VERIFY_TRIGGER_RECOVERED");
    expect(source).toContain('lastContinuousVerifyRecovery>=60000');
    expect(source.indexOf('await recoverPersistedContinuousVerify()')).toBeLessThan(
      source.indexOf('await runPendingContinuousVerify()'));
  });
});
