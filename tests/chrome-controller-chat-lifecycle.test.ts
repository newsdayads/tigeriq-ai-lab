import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-ignore legacy JS module intentionally imported for behavioral regression coverage
import { CHAT_ROTATE_AFTER_DISPATCHES, REFRESH_MAX_MS, shouldRotateNv02Chat } from '../apps/chrome-controller/extension/continuity.js';

describe('App Chrome chat lifecycle',()=>{
  const now=Date.parse('2026-09-23T13:00:00Z');

  it('never rotates a visibly WORKING chat',()=>{
    expect(shouldRotateNv02Chat({
      phase:'WORKING',currentTrackedWork:true,now,
      nextRefreshAt:now-1,dispatchesInChat:CHAT_ROTATE_AFTER_DISPATCHES+10,
      chatStartedAt:now-REFRESH_MAX_MS-1,rotationRetryAt:0,chatLoadRecoveryStage:3,
    })).toBe(false);
  });

  it('rotates READY current chat when old, oversized, or recovery exhausted',()=>{
    expect(shouldRotateNv02Chat({phase:'READY',currentTrackedWork:true,now,nextRefreshAt:now-1,dispatchesInChat:0,chatStartedAt:now-1,rotationRetryAt:0,chatLoadRecoveryStage:0})).toBe(true);
    expect(shouldRotateNv02Chat({phase:'READY',currentTrackedWork:true,now,nextRefreshAt:now+1000,dispatchesInChat:CHAT_ROTATE_AFTER_DISPATCHES,chatStartedAt:now-1,rotationRetryAt:0,chatLoadRecoveryStage:0})).toBe(true);
    expect(shouldRotateNv02Chat({phase:'READY',currentTrackedWork:true,now,nextRefreshAt:now+1000,dispatchesInChat:0,chatStartedAt:now-REFRESH_MAX_MS-1,rotationRetryAt:0,chatLoadRecoveryStage:0})).toBe(true);
    expect(shouldRotateNv02Chat({phase:'STALLED',currentTrackedWork:true,now,nextRefreshAt:now+1000,dispatchesInChat:0,chatStartedAt:now-1,rotationRetryAt:0,chatLoadRecoveryStage:3})).toBe(true);
  });

  it('fails closed when no tracked chat or retry backoff is active',()=>{
    expect(shouldRotateNv02Chat({phase:'READY',currentTrackedWork:false,now,nextRefreshAt:now-1,dispatchesInChat:99,chatStartedAt:now-REFRESH_MAX_MS-1,rotationRetryAt:0,chatLoadRecoveryStage:3})).toBe(false);
    expect(shouldRotateNv02Chat({phase:'READY',currentTrackedWork:true,now,nextRefreshAt:now-1,dispatchesInChat:99,chatStartedAt:now-REFRESH_MAX_MS-1,rotationRetryAt:now+60_000,chatLoadRecoveryStage:3})).toBe(false);
  });


  it('never restores stale conversation URLs and opens a fresh context on boot/manual new chat',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(bridge).toContain("const bootFreshContextPending=new Set(CONTINUITY_WORKERS)");
    expect(bridge).toContain("resumeChatUrl:'', // legacy conversation pointers are intentionally discarded");
    expect(bridge).toContain("resumeUrl:'', // legacy conversation pointers are never restored");
    expect(bridge).not.toContain("await navigate(target,state.resumeChatUrl)");
    expect(bridge).not.toContain("WORKER_RESUME_URL_RESTORED");
    expect(bridge).not.toContain("CURRENT_WORK_NEW_CHAT_RESTORED");
    const nv02Loop=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    expect(nv02Loop).not.toContain("READY_UNASSIGNED");
    expect(bridge).toContain("READY_UNASSIGNED");
    expect(bridge).toContain("BOOT_FRESH_LOCAL_COMPLETE");
    expect(bridge).toContain("LOCAL_CONTINUE_DISPATCHED");
    expect(bridge).toContain("ensureNv02LocalReadyLocked(target,ui,{forceFresh:true})");
    expect(bridge).toContain("ensureNv02LocalReadyLocked(target,raw,{forceFresh:false})");
  });

  it('keeps generic WORKING non-mutating while preserving recovery and view-follow',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const generic=bridge.slice(bridge.indexOf('async function maybeWorkerContinuity'),bridge.indexOf('\nfunction log('));
    const working=generic.slice(generic.indexOf("if(phase==='WORKING')"),generic.indexOf("if(phase==='READY')"));
    expect(working).toContain("'WORKING_LONG_RUNNING_NO_MUTATION'");
    expect(working).not.toContain('stopStalledWorking');
    expect(working).not.toContain('reloadTarget');
    expect(working).not.toContain('reopenWorker');
    expect(bridge).toContain("chatLoadRecoveryStage:Number(raw.chatLoadRecoveryStage)||0");
    expect(bridge).toContain("genericWorkerEvent(w.id,deferred?'VIEW_FOLLOW_BOTTOM_DEFERRED':'VIEW_FOLLOW_BOTTOM'");
    expect(bridge).toContain("nextViewFollowAt:Number(raw.nextViewFollowAt)");
    expect(bridge).toContain("nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)");
  });
});
