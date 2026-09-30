import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-ignore legacy JS module intentionally imported for behavioral regression coverage
import { shouldRotateNv02Chat } from '../apps/chrome-controller/extension/continuity.js';

describe('App Chrome chat lifecycle',()=>{
  const now=Date.parse('2026-09-23T13:00:00Z');

  it('never rotates a visibly WORKING chat',()=>{
    expect(shouldRotateNv02Chat({phase:'WORKING',currentTrackedWork:true,now,rotationRetryAt:0,chatLoadRecoveryStage:3})).toBe(false);
  });

  it('never rotates merely because of chat age or prompt count',()=>{
    expect(shouldRotateNv02Chat({phase:'READY',currentTrackedWork:true,now,nextRefreshAt:now-1,dispatchesInChat:999,chatStartedAt:1,rotationRetryAt:0,chatLoadRecoveryStage:0})).toBe(false);
  });

  it('allows a fresh chat only after bounded recovery exhaustion',()=>{
    expect(shouldRotateNv02Chat({phase:'READY',currentTrackedWork:true,now,rotationRetryAt:0,chatLoadRecoveryStage:3})).toBe(true);
    expect(shouldRotateNv02Chat({phase:'STALLED',currentTrackedWork:true,now,rotationRetryAt:0,chatLoadRecoveryStage:3})).toBe(true);
  });

  it('fails closed when no tracked chat or retry backoff is active',()=>{
    expect(shouldRotateNv02Chat({phase:'READY',currentTrackedWork:false,now,rotationRetryAt:0,chatLoadRecoveryStage:3})).toBe(false);
    expect(shouldRotateNv02Chat({phase:'READY',currentTrackedWork:true,now,rotationRetryAt:now+60_000,chatLoadRecoveryStage:3})).toBe(false);
  });

  it('handles fresh-chat normal boot and crash-only restore correctly',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(bridge).toContain("const bootFreshContextPending=new Set(CONTINUITY_WORKERS)");
    expect(bridge).toContain("resumeChatUrl:'', // legacy conversation pointers are intentionally discarded");
    expect(bridge).toContain("resumeUrl:'', // legacy conversation pointers are never restored");
    expect(bridge).not.toContain("await navigate(target,state.resumeChatUrl)");
    const nv02Loop=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    expect(nv02Loop).toContain("rotateNv02ToFreshChat(target,state,'BOOT_FRESH_CHAT'");
    expect(nv02Loop).not.toContain("restoreVerifiedChatUrl");
    expect(nv02Loop).toContain("state.crashResumePending===true&&isRestorableNv02Chat(state.crashResumeUrl)");
    expect(nv02Loop).toContain("await navigate(target,crashResumeUrl)");
    expect(nv02Loop).toContain("waitForNv02PreservedChatSettled(target,crashResumeUrl,30000)");
    expect(nv02Loop).toContain("'NV02_CRASH_CHAT_RESTORED'");
    expect(bridge).toContain("log('NV02_CRASH_CHAT_RESUME_ARMED'");
    expect(bridge).toContain("if(now<Number(state.modelCheckBlockedUntil||0))return");
    expect(bridge).toContain("bootFreshContextPending.add('NV02')");
    expect(bridge).toContain("await archiveChat(target)");
    expect(bridge).toContain("await newChat(target)");
    expect(bridge).toContain("dispatchesInChat:0,chatStartedAt:now");
    expect(bridge).toContain("LOCAL_CONTINUE_DISPATCHED");
    expect(bridge).toContain("waitForNv02Composer(target,30000)||raw");
  });

  it('archives NV02 from the current chat header menu, not the Project list',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(bridge).toContain("source:direct.length?'HEADER_CONVERSATION_OPTIONS':'HEADER_TOOLBAR_MORE'");
    expect(bridge).toContain("ARCHIVE_HEADER_MENU_COUNT_");
    expect(bridge).toContain("ARCHIVE_NOT_CONFIRMED_LEFT_CURRENT_CONVERSATION");
    const archiveStart=bridge.indexOf('function archiveMenuPointExpr');
    const archiveEnd=bridge.indexOf('function newChatExpr',archiveStart);
    const archiveBlock=bridge.slice(archiveStart,archiveEnd);
    expect(archiveBlock).not.toContain('archiveProjectRowPointExpr');
    expect(archiveBlock).not.toContain('archiveProjectMenuPointExpr');
    expect(archiveBlock).not.toContain("await p.call('Page.navigate',{url:NV02_HOME_URL})");
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
