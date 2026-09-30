import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-ignore legacy JS module intentionally imported for behavioral regression coverage
import { CONTINUE_PROMPTS, detectWorkerAssistantTerminal, pickWorkerContinuePrompt } from '../apps/chrome-controller/extension/continuity.js';

describe('App Chrome Recovery V1 local-only spec lock',()=>{
  it('uses only short prefixed local prompts for NV02/NV03/NV04',()=>{
    expect(CONTINUE_PROMPTS).toHaveLength(21);
    for(const id of ['NV02','NV03','NV04']){
      const prompt=pickWorkerContinuePrompt(id,'',()=>0);
      expect(prompt).toMatch(new RegExp('^'+id.slice(-2)+' - '));
      expect(prompt).toContain(CONTINUE_PROMPTS[0]);
      expect(prompt).not.toMatch(/Core|GitHub|claim|assignment|P0|P1-P5/i);
    }
  });

  it('keeps Core/GitHub selection out while requiring a local durable assignment for NV03/NV04',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    for(const forbidden of [
      'CORE_UI_ASSIGNMENT',
      'currentWorkerAssignmentStatus(',
      'READY_UNASSIGNED',
      'ROLE_FALLBACK',
      'CORE_ASSIGNMENT',
      'CORE_CONTINUE',
      'audit GitHub Source of Truth',
      'TIGERIQ_ROLE_CLAIM_V1',
      'Core assignment còn hiệu lực',
    ]) expect(bridge).not.toContain(forbidden);

    const generic=bridge.slice(bridge.indexOf('async function maybeWorkerContinuity'),bridge.indexOf('\nfunction log('));
    const nv02=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    expect(generic).toContain("if(phase==='WORKING')");
    expect(generic).toContain("if(phase==='READY')");
    expect(generic).toContain('awaitingWorkStart');
    expect(generic).toContain('chooseLocalContinuePrompt(w.id,state)');
    expect(generic).toContain('activeLocalAssignment(controller,w.id)');
    expect(generic).toContain("'NO_ACTIVE_ASSIGNMENT_IDLE'");
    expect(generic).toContain("'ASSISTANT_TERMINAL_WAIT'");
    expect(bridge).toContain('model-response-content');
    expect(nv02).toContain("if(phase==='WORKING')");
    expect(nv02).toContain("if(phase==='READY')");
    expect(nv02).toContain('awaitingWorkStart');
    expect(nv02).toContain('dispatchNaturalContinue(target,state,now)');
  });

  it('detects terminal responses from raw ChatGPT and Gemini text without false newline assumptions',()=>{
    expect(detectWorkerAssistantTerminal('prefix\nEXTERNAL_WAIT — dependency')).toBe('EXTERNAL_WAIT');
    expect(detectWorkerAssistantTerminal('  DONE — complete')).toBe('DONE');
    expect(detectWorkerAssistantTerminal('CLAIM_ID=x REVIEW=BLOCKED STATE=BLOCKED LEASE=RELEASED')).toBe('BLOCKED');
    expect(detectWorkerAssistantTerminal('Analysis mentions BLOCKED but state is still working.')).toBe('');
  });

  it('preserves the active specialist chat during bounded recovery and defers periodic reset',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(bridge).toContain("async function reopenWorker(w,target,state,now,reason,resumeUrl='')");
    expect(bridge).toContain('const preserveAssignedChat=isAssignedWorkerChat(w,resumeCandidate)');
    expect(bridge).toContain("'PERIODIC_RESET_DEFERRED_ACTIVE_ASSIGNMENT'");
    expect(bridge).toContain("'STALLED_3_CHECKS',isAssignedWorkerChat(w,ui?.url)?ui.url:''");
    expect(bridge).toContain("'CHAT_LOAD_ERROR',isAssignedWorkerChat(w,ui?.url)?ui.url:''");
  });

  it('stops generic continuity on terminal output even if the UI is still reporting WORKING',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const generic=bridge.slice(bridge.indexOf('async function maybeWorkerContinuity'),bridge.indexOf('\nfunction log('));
    expect(generic).toContain("['DONE','BLOCKED','EXTERNAL_WAIT','READY_NO_ELIGIBLE_WORK','TIGERIQ_CHAT_ROTATE_READY'].includes");
    expect(generic).not.toContain("phase!=='WORKING'&&['DONE','BLOCKED','EXTERNAL_WAIT'");
  });

  it('derives worker READY from local UI state rather than assignment state',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const tick=bridge.slice(bridge.indexOf('async function tickWorker'),bridge.indexOf('async function main'));
    expect(tick).toContain('const localReady=projectContextReady&&rawUi?.composerReady===true');
    expect(tick).not.toContain('assignmentSnapshot');
    expect(tick).not.toContain('idleReady');
  });

  it('keeps independent WORKING F5/reset and anti-spam guards',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const nv02Loop=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    expect(nv02Loop).toContain("if(now>=Number(state.nextPeriodicF5At||0))");
    expect(nv02Loop).toContain("if(now>=Number(state.nextRefreshAt||0))");
    expect(nv02Loop).not.toContain("if(phase!=='WORKING'&&now>=Number(state.nextRefreshAt||0))");
    expect(nv02Loop).not.toContain("PERIODIC_F5_DEFERRED_WORKING");
    expect(nv02Loop).toContain('awaitingWorkStart===true');
    expect(nv02Loop).not.toContain('WORK_START_ACK_TIMEOUT_REARMED');
  });
});
