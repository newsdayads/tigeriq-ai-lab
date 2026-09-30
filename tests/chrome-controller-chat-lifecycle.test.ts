import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('App Chrome chat lifecycle',()=>{
  it('has no count/age based automatic rotation helper',()=>{
    const continuity=readFileSync('apps/chrome-controller/extension/continuity.js','utf8');
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(continuity).not.toContain('shouldRotateNv02Chat');
    expect(continuity).not.toContain('CHAT_ROTATE_AFTER_DISPATCHES');
    expect(bridge).not.toContain('NV02_MAX_DISPATCHES_PER_CHAT');
    expect(bridge).not.toContain('NV02_MAX_CHAT_AGE_MS');
  });

  it('preserves normal boot context and keeps crash-only restore explicit',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(bridge).toContain("const bootFreshContextPending=new Set(CONTINUITY_WORKERS)");
    expect(bridge).not.toContain("await navigate(target,state.resumeChatUrl)");
    const nv02Loop=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    expect(nv02Loop).not.toContain("rotateNv02ToFreshChat(target,state,'BOOT_FRESH_CHAT'");
    expect(nv02Loop).toContain("'BOOT_CONTEXT_PRESERVED_OR_RECOVERED'");
    expect(nv02Loop).toContain("state.crashResumePending===true&&isRestorableNv02Chat(state.crashResumeUrl)");
    expect(nv02Loop).toContain("await navigate(target,crashResumeUrl)");
    expect(nv02Loop).toContain("waitForNv02PreservedChatSettled(target,crashResumeUrl,30000)");
    expect(nv02Loop).toContain("'NV02_CRASH_CHAT_RESTORED'");
    expect(bridge).toContain("log('NV02_CRASH_CHAT_RESUME_ARMED'");
    expect(bridge).toContain("if(now<Number(state.modelCheckBlockedUntil||0))return");
    expect(bridge).toContain("bootFreshContextPending.add('NV02')");
    const recovery=bridge.slice(bridge.indexOf('async function maybeRecoverChatLoadError'),bridge.indexOf('const MODEL_SELECTOR_POINT_EXPR'));
    expect(recovery).toContain("rotateNv02ToFreshChat(target,checkpoint,'CHAT_LOAD_ERROR'");
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
