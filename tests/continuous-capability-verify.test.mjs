import { describe, expect, it } from 'vitest';
import {
  CONTINUOUS_VERIFY_CADENCE_MS,
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
