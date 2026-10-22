import {readFileSync} from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  managerJobMaterializationDecision,
  managerLogicalJobIdentity,
  normalizeManagerLogicalTitle,
} from '../apps/tigeriq-core/manager-job-policy.mjs';
import {
  CONTINUOUS_VERIFY_CADENCE_MS,
  createContinuousVerifyPendingQueue,
  cadenceContinuousVerifyDue,
  continuousVerifyRelevantPath,
  githubChangedPaths,
  githubContinuousVerifyTrigger,
  runtimeContinuousVerifyTrigger,
  shouldQueueContinuousVerify,
} from '../apps/tigeriq-core/continuous-verify.mjs';
import {
  anomalyMaterializationDecision,
  syntheticSelfAuditCanary,
} from '../apps/tigeriq-core/self-audit.mjs';

describe('Continuous Capability Verification trigger policy', () => {
  it('D1 triggers only for relevant main changes', () => {
    const push = githubContinuousVerifyTrigger({
      eventName:'push',
      deliveryId:'delivery-1',
      payload:{ref:'refs/heads/main',after:'abc1234',commits:[{modified:['apps/tigeriq-core/core.mjs']}]},
    });
    expect(push).toMatchObject({trigger:true,kind:'GITHUB_MAIN_PUSH',key:'github-main:abc1234',sourceSha:'abc1234'});
    expect(push.relevantPaths).toEqual(['apps/tigeriq-core/core.mjs']);

    const pr = githubContinuousVerifyTrigger({
      eventName:'pull_request',
      deliveryId:'delivery-2',
      payload:{action:'closed',changedPaths:['api/live-status.mjs'],pull_request:{merged:true,merge_commit_sha:'merge123',base:{ref:'main'},head:{sha:'head123'}}},
    });
    expect(pr).toMatchObject({trigger:true,kind:'GITHUB_MAIN_MERGE',key:'github-main:merge123'});
  });

  it('GH-5169 detects a shared-module-only GitHub push and merged PR', () => {
    const shared='apps/shared/work-center-history.mjs';
    expect(continuousVerifyRelevantPath(shared)).toBe(true);
    expect(continuousVerifyRelevantPath('apps/shared/rdc-account-preflight.mjs')).toBe(true);
    const push=githubContinuousVerifyTrigger({
      eventName:'push',
      payload:{
        ref:'refs/heads/main',after:'main-shared-5169',
        commits:[{modified:[shared]}],
      },
    });
    expect(push).toMatchObject({
      trigger:true,kind:'GITHUB_MAIN_PUSH',key:'github-main:main-shared-5169',
      relevantPaths:[shared],
    });
    const merge=githubContinuousVerifyTrigger({
      eventName:'pull_request',
      payload:{
        action:'closed',
        changedPaths:['apps/shared/rdc-account-preflight.mjs'],
        pull_request:{merged:true,merge_commit_sha:'merge-shared-5169',base:{ref:'main'}},
      },
    });
    expect(merge).toMatchObject({
      trigger:true,kind:'GITHUB_MAIN_MERGE',key:'github-main:merge-shared-5169',
      relevantPaths:['apps/shared/rdc-account-preflight.mjs'],
    });
  });

  it('GH-5169 still ignores unrelated changes and non-main shared branches', () => {
    expect(continuousVerifyRelevantPath('docs/notes.md')).toBe(false);
    expect(githubContinuousVerifyTrigger({
      eventName:'push',
      payload:{ref:'refs/heads/feature/shared',after:'sha',commits:[{modified:['apps/shared/work-center-history.mjs']}]},
    })).toMatchObject({trigger:false,kind:'GITHUB_UNRELATED'});
    expect(githubContinuousVerifyTrigger({
      eventName:'push',
      payload:{ref:'refs/heads/main',after:'sha',commits:[{modified:['docs/notes.md']}]},
    })).toMatchObject({trigger:false,kind:'GITHUB_CHANGE_UNRELATED'});
  });

  it('D2 ignores unrelated or unknown-scope main changes', () => {
    expect(githubContinuousVerifyTrigger({eventName:'issues',payload:{action:'edited'}}).trigger).toBe(false);
    expect(githubContinuousVerifyTrigger({
      eventName:'push',
      payload:{ref:'refs/heads/main',after:'docs1',commits:[{modified:['docs/notes.md']}]},
    })).toMatchObject({trigger:false,kind:'GITHUB_CHANGE_UNRELATED'});
    expect(githubContinuousVerifyTrigger({
      eventName:'pull_request',
      payload:{action:'closed',pull_request:{merged:true,merge_commit_sha:'abc',base:{ref:'main'}}},
    })).toMatchObject({trigger:false,kind:'GITHUB_CHANGE_SCOPE_UNKNOWN'});
    expect(continuousVerifyRelevantPath('apps/tigeriq-core/core.mjs')).toBe(true);
    expect(continuousVerifyRelevantPath('docs/notes.md')).toBe(false);
    expect(githubChangedPaths({commits:[{added:['api/x.mjs'],modified:['docs/x.md']}]})).toEqual(['api/x.mjs','docs/x.md']);
  });

  it('D1 runtime trigger waits for installed relevant core impact', () => {
    expect(runtimeContinuousVerifyTrigger('', 'sha-a')).toMatchObject({trigger:false,kind:'RUNTIME_UNCHANGED'});
    expect(runtimeContinuousVerifyTrigger('sha-a', 'sha-b',{installedSha:'sha-a',coreImpact:true})).toMatchObject({trigger:false,kind:'RUNTIME_INSTALL_PENDING'});
    expect(runtimeContinuousVerifyTrigger('sha-a', 'sha-b',{installedSha:'sha-b',coreImpact:false})).toMatchObject({trigger:false,kind:'RUNTIME_CHANGE_UNRELATED'});
    expect(runtimeContinuousVerifyTrigger('sha-a', 'sha-b',{installedSha:'sha-b',coreImpact:true})).toMatchObject({
      trigger:true,kind:'RUNTIME_SHA_CHANGE',key:'runtime:sha-b',previousSha:'sha-a',currentSha:'sha-b',
    });
  });

  it('D5 dedupes a pending or already-run trigger key', () => {
    const trigger={trigger:true,key:'runtime:sha-b'};
    expect(shouldQueueContinuousVerify(trigger,{pendingKey:'runtime:sha-b'})).toBe(false);
    expect(shouldQueueContinuousVerify(trigger,{runningKey:'runtime:sha-b'})).toBe(false);
    expect(shouldQueueContinuousVerify(trigger,{lastRunKey:'runtime:sha-b'})).toBe(false);
    expect(shouldQueueContinuousVerify(trigger,{lastRunKey:'runtime:sha-a'})).toBe(true);
  });

  it('GH-5174 preserves distinct main events in bounded FIFO without overwriting earlier keys', () => {
    const q=createContinuousVerifyPendingQueue({capacity:3,now:()=> '2026-10-23T00:00:00Z'});
    const mk=key=>({trigger:true,key,kind:'GITHUB_MAIN_PUSH'});
    expect(q.enqueue(mk('github-main:a'))).toMatchObject({accepted:true,depth:1});
    expect(q.enqueue(mk('github-main:b'))).toMatchObject({accepted:true,depth:2});
    expect(q.enqueue(mk('github-main:a'))).toMatchObject({accepted:false,reason:'DUPLICATE_OR_INVALID'});
    expect(q.enqueue(mk('github-main:c'))).toMatchObject({accepted:true,depth:3});
    expect(q.keys()).toEqual(['github-main:a','github-main:b','github-main:c']);
    expect(q.enqueue(mk('github-main:d'))).toMatchObject({accepted:false,reason:'CAPACITY_REACHED',depth:3});
    expect([q.take()?.key,q.take()?.key,q.take()?.key]).toEqual([
      'github-main:a','github-main:b','github-main:c',
    ]);
    expect(q.take()).toBeNull();
    expect(q.size).toBe(0);
  });

  it('GH-5174 dedupes running and terminal keys and prioritizes one bounded retry', () => {
    const q=createContinuousVerifyPendingQueue({capacity:2,now:()=> '2026-10-23T00:00:00Z'});
    const mk=key=>({trigger:true,key,kind:'GITHUB_MAIN_PUSH'});
    q.enqueue(mk('github-main:old'));
    const active=q.take();
    expect(q.enqueue(mk('github-main:old'),{runningKey:active.key})).toMatchObject({
      accepted:false,reason:'DUPLICATE_OR_INVALID',
    });
    q.enqueue(mk('github-main:new'));
    q.enqueue(mk('github-main:last'));
    expect(q.enqueue(mk('github-main:overflow'))).toMatchObject({reason:'CAPACITY_REACHED'});
    expect(q.retryFirst(active)).toMatchObject({accepted:true,depth:3});
    expect(q.keys()).toEqual(['github-main:old','github-main:new','github-main:last']);
    const retry=q.take();
    expect(retry.attempt).toBe(1);
    expect(q.retryFirst(retry)).toMatchObject({accepted:false,reason:'RETRY_DENIED'});
    expect(q.enqueue(mk('github-main:old'),{lastRunKey:'github-main:old'})).toMatchObject({
      accepted:false,reason:'DUPLICATE_OR_INVALID',
    });
    expect([q.take()?.key,q.take()?.key]).toEqual(['github-main:new','github-main:last']);
  });

  it('GH-5174 serializes terminal lookup before the next Core queue dequeue', () => {
    const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    const start=source.indexOf('async function runPendingContinuousVerify()');
    const end=source.indexOf('function selfAuditStateFresh(',start);
    const body=source.slice(start,end);
    expect(start).toBeGreaterThan(0);
    expect(body.indexOf('continuousVerifyRunning=true;')).toBeLessThan(
      body.indexOf('await continuousVerifyAlreadyTerminal(trigger.key)')
    );
    expect(body).toContain('continuousVerifyPending.take()');
    expect(body).toContain('continuousVerifyPending.retryFirst(trigger)');
    expect(body).toContain('finally{');
    expect(source).toContain("CONTINUOUS_VERIFY_QUEUE_OVERFLOW");
  });

  it('D3 keeps bounded cadence verification when no change occurs', () => {
    const now=Date.parse('2026-10-02T06:00:00Z');
    expect(cadenceContinuousVerifyDue({nowMs:now,lastRunMs:0})).toBe(true);
    expect(cadenceContinuousVerifyDue({nowMs:now,lastRunMs:now-CONTINUOUS_VERIFY_CADENCE_MS+1})).toBe(false);
    expect(cadenceContinuousVerifyDue({nowMs:now,lastRunMs:now-CONTINUOUS_VERIFY_CADENCE_MS})).toBe(true);
  });

  it('D4 catches a synthetic regression and marks fresh signatures for materialization', () => {
    const canary=syntheticSelfAuditCanary({nowMs:Date.parse('2026-10-02T06:00:00Z')});
    expect(canary.pass).toBe(true);
    expect(canary.queueMutation).toBe(false);
    expect(canary.anomalies.length).toBeGreaterThanOrEqual(2);
    for(const anomaly of canary.anomalies){
      expect(anomalyMaterializationDecision(null,anomaly)).toMatchObject({materialize:true,reason:'NEW_SIGNATURE'});
    }
  });
});


describe('Manager logical job materialization policy', () => {
  it('dedupes the same logical title inside one objective and phase', () => {
    expect(normalizeManagerLogicalTitle('  STAB-R1-Job1  ')).toBe('stab-r1-job1');
    const a=managerLogicalJobIdentity({objectiveId:'OBJ-1',phaseIndex:0,title:'STAB-R1-Job1'});
    const b=managerLogicalJobIdentity({objectiveId:'OBJ-1',phaseIndex:0,title:' stab-r1-job1 '});
    expect(a).toEqual(b);
    expect(managerJobMaterializationDecision('queued')).toMatchObject({action:'dedupe'});
    expect(managerJobMaterializationDecision('running')).toMatchObject({action:'dedupe'});
    expect(managerJobMaterializationDecision('done')).toMatchObject({action:'dedupe'});
    expect(managerJobMaterializationDecision('waiting_resource')).toMatchObject({action:'dedupe'});
  });

  it('stops a terminal failed logical job instead of creating infinite duplicates', () => {
    expect(managerJobMaterializationDecision('failed')).toMatchObject({action:'block',reason:'previous_failed_terminal_no_duplicate_job'});
    expect(managerJobMaterializationDecision('')).toMatchObject({action:'create',reason:'no_existing_job'});
  });

  it('keeps different phases distinct', () => {
    const r1=managerLogicalJobIdentity({objectiveId:'OBJ-1',phaseIndex:0,title:'Job1'});
    const r2=managerLogicalJobIdentity({objectiveId:'OBJ-1',phaseIndex:1,title:'Job1'});
    expect(r1.phaseIndex).not.toBe(r2.phaseIndex);
  });
});
