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

  it('wires real stuck-WORKING recovery and view-follow for generic workers',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(bridge).toContain("stopStalledWorking(target)");
    expect(bridge).toContain("'WORKING_STUCK_STOP'");
    expect(bridge).toContain("chatLoadRecoveryStage:resolved?3");
    expect(bridge).toContain("genericWorkerEvent(w.id,deferred?'VIEW_FOLLOW_BOTTOM_DEFERRED':'VIEW_FOLLOW_BOTTOM'");
    expect(bridge).toContain("nextViewFollowAt:Number(raw.nextViewFollowAt)");
    expect(bridge).toContain("chatStartedAt:state.chatStartedAt");
  });

  it('controller admits stuck Stop only for a visible busy generation',()=>{
    const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    expect(server).toContain("const workingStuckStop=purpose==='WORKING_STUCK_STOP'");
    expect(server).toContain("state.lastHeartbeat?.uiBusy===true");
    expect(server).toContain("state.lastHeartbeat?.stopVisible===true");
    expect(server).toContain("!workingStuckStop&&!periodicF5");
    expect(server).toContain("WORKING_STUCK_STOP_REQUIRES_VISIBLE_STOP");
  });
});
