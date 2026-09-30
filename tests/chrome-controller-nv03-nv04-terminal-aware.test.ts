import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('NV03/NV04 terminal-aware continuity #2549',()=>{
  it('continues only a currently bound SUBMITTED/WORKING UI job',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const generic=bridge.slice(bridge.indexOf('async function maybeWorkerContinuity'),bridge.indexOf('\nfunction log('));
    const command=bridge.slice(bridge.indexOf('async function handleCommand'),bridge.indexOf('async function postWorkerHeartbeat'));

    expect(bridge).toContain('async function getWorkerJobBinding(workerId)');
    expect(bridge).toContain("['SUBMITTED','WORKING'].includes(String(job.stage||'').toUpperCase())");
    expect(generic).toContain('getWorkerJobBinding(w.id)');
    expect(generic).toContain('genericWorkerJobContinuable(activeJob)');
    expect(generic).toContain('LOCAL_CONTINUITY_STOPPED_JOB_STATE');
    expect(command).toContain('getWorkerJobBinding(w.id)');
    expect(command).toContain("status:'READY_UNASSIGNED'");
  });

  it('waits for a clean home context before an assigned job can be dispatched',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const command=bridge.slice(bridge.indexOf('async function handleCommand'),bridge.indexOf('async function postWorkerHeartbeat'));

    expect(bridge).toContain('async function waitForWorkerFreshContext(w,target,timeoutMs=30000)');
    expect(bridge).toContain('isWorkerFreshContext(w,last.url)');
    expect(bridge).toContain('FRESH_CONTEXT_NOT_READY:');
    expect(command).toContain("status:'FRESH_CONTEXT_READY'");
    expect(command).toContain('ASSIGNED_WORK_DISPATCHED_GUARD_ARMED');
  });
});
