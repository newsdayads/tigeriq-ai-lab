import { describe, expect, it } from 'vitest';
import {
  CONTINUOUS_VERIFY_CADENCE_MS,
  cadenceContinuousVerifyDue,
  githubContinuousVerifyTrigger,
  runtimeContinuousVerifyTrigger,
  shouldQueueContinuousVerify,
} from './continuous-verify.mjs';

describe('Continuous Capability Verification trigger policy', () => {
  it('triggers on a merged PR to main', () => {
    const out = githubContinuousVerifyTrigger({
      eventName:'pull_request',
      deliveryId:'delivery-1',
      payload:{action:'closed',pull_request:{merged:true,merge_commit_sha:'abc1234',base:{ref:'main'},head:{sha:'def5678'}}},
    });
    expect(out).toMatchObject({trigger:true,kind:'GITHUB_MAIN_MERGE',key:'github-main:abc1234',sourceSha:'abc1234'});
  });

  it('does not trigger a full verification for unrelated GitHub changes', () => {
    expect(githubContinuousVerifyTrigger({eventName:'issues',payload:{action:'edited'}}).trigger).toBe(false);
    expect(githubContinuousVerifyTrigger({
      eventName:'pull_request',
      payload:{action:'closed',pull_request:{merged:true,merge_commit_sha:'abc',base:{ref:'feature'}}},
    }).trigger).toBe(false);
  });

  it('triggers when installed runtime SHA changes after baseline observation', () => {
    expect(runtimeContinuousVerifyTrigger('', 'sha-a').trigger).toBe(false);
    expect(runtimeContinuousVerifyTrigger('sha-a', 'sha-a').trigger).toBe(false);
    expect(runtimeContinuousVerifyTrigger('sha-a', 'sha-b')).toMatchObject({
      trigger:true,kind:'RUNTIME_SHA_CHANGE',key:'runtime:sha-b',previousSha:'sha-a',currentSha:'sha-b',
    });
  });

  it('dedupes a pending or already-run trigger key', () => {
    const trigger={trigger:true,key:'runtime:sha-b'};
    expect(shouldQueueContinuousVerify(trigger,{pendingKey:'runtime:sha-b'})).toBe(false);
    expect(shouldQueueContinuousVerify(trigger,{lastRunKey:'runtime:sha-b'})).toBe(false);
    expect(shouldQueueContinuousVerify(trigger,{lastRunKey:'runtime:sha-a'})).toBe(true);
  });

  it('keeps bounded cadence verification when no change occurs', () => {
    const now=Date.parse('2026-10-02T06:00:00Z');
    expect(cadenceContinuousVerifyDue({nowMs:now,lastRunMs:0})).toBe(true);
    expect(cadenceContinuousVerifyDue({nowMs:now,lastRunMs:now-CONTINUOUS_VERIFY_CADENCE_MS+1})).toBe(false);
    expect(cadenceContinuousVerifyDue({nowMs:now,lastRunMs:now-CONTINUOUS_VERIFY_CADENCE_MS})).toBe(true);
  });
});
