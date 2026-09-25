import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-ignore legacy JS module intentionally imported for behavioral regression coverage
import { CONTINUE_PROMPTS, pickWorkerContinuePrompt } from '../apps/chrome-controller/extension/continuity.js';

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

  it('contains no Core/assignment/self-claim gate in the Direct CDP continuity path',()=>{
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
    expect(nv02).toContain("if(phase==='WORKING')");
    expect(nv02).toContain("if(phase==='READY')");
    expect(nv02).toContain('awaitingWorkStart');
    expect(nv02).toContain('dispatchNaturalContinue(target,state,now)');
  });

  it('derives worker READY from local UI state rather than assignment state',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const tick=bridge.slice(bridge.indexOf('async function tickWorker'),bridge.indexOf('async function main'));
    expect(tick).toContain('const localReady=projectContextReady&&rawUi?.composerReady===true');
    expect(tick).not.toContain('assignmentSnapshot');
    expect(tick).not.toContain('idleReady');
  });

  it('keeps WORKING-safe F5/restart and anti-spam guards',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(bridge).toContain("PERIODIC_F5_DEFERRED_WORKING");
    expect(bridge).toContain("if(phase!=='WORKING'&&now>=Number(state.nextRefreshAt||0))");
    expect(bridge).toContain('awaitingWorkStart===true');
    expect(bridge).toContain('WORK_START_ACK_TIMEOUT_REARMED');
  });
});
