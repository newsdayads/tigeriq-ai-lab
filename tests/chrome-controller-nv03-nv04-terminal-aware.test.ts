import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('NV03/NV04 terminal-aware continuity #2549',()=>{
  it('continues only while the bound local UI job is SUBMITTED or WORKING',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const binding=bridge.slice(bridge.indexOf('function activeLocalAssignment'),bridge.indexOf('async function chooseLocalContinuePrompt'));
    const generic=bridge.slice(bridge.indexOf('async function maybeWorkerContinuity'),bridge.indexOf('\nfunction log('));
    const command=bridge.slice(bridge.indexOf('async function handleCommand'),bridge.indexOf('async function postWorkerHeartbeat'));

    expect(binding).toContain("new Set(['SUBMITTED','WORKING'])");
    expect(binding).not.toContain('WAITING_EVIDENCE');
    expect(binding).not.toContain('VERIFY');
    expect(generic).toContain('activeLocalAssignment(controller,w.id)');
    expect(generic).toContain("'NO_ACTIVE_ASSIGNMENT_IDLE'");
    expect(command).toContain('activeLocalAssignment(controller,w.id)');
    expect(command).toContain("status:'NO_ACTIVE_WORK'");
  });

  it('waits for the clean home context before an assigned prompt can be sent',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const command=bridge.slice(bridge.indexOf('async function handleCommand'),bridge.indexOf('async function postWorkerHeartbeat'));

    expect(bridge).toContain('async function waitForWorkerFreshContext(w,target,timeoutMs=30000)');
    expect(bridge).toContain('isWorkerFreshContext(w,last.url)');
    expect(bridge).toContain('FRESH_CONTEXT_NOT_READY:');
    expect(command).toContain("status:'FRESH_CONTEXT_READY'");
    expect(command).toContain("bootFreshContextPending.delete(w.id)");
    expect(command).toContain("ASSIGNMENT_FRESH_CONTEXT_ACKNOWLEDGED");
    expect(command).toContain('ASSIGNED_WORK_DISPATCHED_GUARD_ARMED');
  });

  it('preserves terminal-text fail-closed behavior for ChatGPT and Gemini',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const generic=bridge.slice(bridge.indexOf('async function maybeWorkerContinuity'),bridge.indexOf('\nfunction log('));

    expect(bridge).toContain('model-response-content');
    expect(generic).toContain("'ASSISTANT_TERMINAL_WAIT'");
    expect(generic).toContain("'DONE','BLOCKED','EXTERNAL_WAIT'");
  });
  it('retries transient Runtime.evaluate gaps and fails closed instead of cascading undefined UI state',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(bridge).toContain('for(let attempt=1;attempt<=3;attempt+=1)');
    expect(bridge).toContain('UI_STATE_EVALUATE_EXCEPTION:');
    expect(bridge).toContain('UI_STATE_VALUE_UNAVAILABLE:');
    expect(bridge).toContain("'UI_STATE_READ_RETRY'");
    expect(bridge).toContain("'UI_STATE_RECOVERED_AFTER_RETRY'");
    expect(bridge).toContain("'UI_STATE_UNAVAILABLE_FAIL_CLOSED'");
  });

});
