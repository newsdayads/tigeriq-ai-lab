import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WORKER_IDS } from '../apps/chrome-controller/src/model.js';
import { classifyWorkerPresence, processProbeFromCount } from '../apps/chrome-controller/src/worker-presence.js';
import { BrowserMutationLeaseStore } from '../apps/chrome-controller/src/browser-mutation-lease.js';
import {
  persistWorkerSafetyStateOrFailClosed,
  readWorkerSafetyState,
  restoreWorkerSafetyState,
  workerStartGate,
  writeWorkerSafetyState,
} from '../apps/chrome-controller/src/worker-safety-state.js';

const roots:string[]=[];
function root(){const p=mkdtempSync(join(tmpdir(),'tigeriq-recovery-'));roots.push(p);return p;}
afterEach(()=>{while(roots.length)rmSync(roots.pop()!,{recursive:true,force:true});});

describe('worker presence classification',()=>{
  it('treats live CDP as RUNNING',()=>{
    expect(classifyWorkerPresence(true,'UNKNOWN')).toBe('RUNNING');
    expect(classifyWorkerPresence(true,'ABSENT')).toBe('RUNNING');
  });
  it('requires explicit process absence before ABSENT',()=>{
    expect(processProbeFromCount(0,undefined)).toBe('ABSENT');
    expect(processProbeFromCount(1,undefined)).toBe('PRESENT');
    expect(processProbeFromCount(undefined,false)).toBe('UNKNOWN');
    expect(processProbeFromCount(undefined,true)).toBe('PRESENT');
    expect(classifyWorkerPresence(false,'ABSENT')).toBe('ABSENT');
    expect(classifyWorkerPresence(false,'PRESENT')).toBe('AMBIGUOUS');
    expect(classifyWorkerPresence(false,'UNKNOWN')).toBe('AMBIGUOUS');
  });
});

describe('planned reset mutation lease handoff',()=>{
  it('executes bridge ownership validation then releases before controller recovery',()=>{
    const path=join(root(),'browser-mutation-leases.json');
    const store=new BrowserMutationLeaseStore(path);
    const ownerId='DIRECT_CDP_BRIDGE:123:NV03';
    const acquired=store.acquire('NV03',ownerId,60_000,1_000);
    expect(acquired.kind).toBe('ACQUIRED');
    if(acquired.kind!=='ACQUIRED')throw new Error('lease not acquired');
    expect(store.assertOwned('NV03',ownerId,acquired.lease.leaseId,1_001).leaseId).toBe(acquired.lease.leaseId);
    expect(()=>store.assertControllerAllowed('NV03',1_001)).toThrow(/BROWSER_MUTATION_LEASE_BUSY/);
    expect(store.release('NV03',ownerId,acquired.lease.leaseId)).toBe(true);
    expect(()=>store.assertControllerAllowed('NV03',1_002)).not.toThrow();
  });
});

describe('controller restart-safe worker safety gates',()=>{
  it('restores paused NV02 through the same boot restore path used by Controller',()=>{
    const path=join(root(),'worker-safety-state.json');
    writeWorkerSafetyState(path,{pausedWorkers:['NV02'],manualCloseSuppressedWorkers:[]},new Date('2026-09-19T00:00:00Z'));
    const boot=restoreWorkerSafetyState(path);
    expect(boot.failClosed).toBe(false);
    expect(boot.state.pausedWorkers).toEqual(['NV02']);
    expect(workerStartGate('NV02',{
      globalPaused:false,
      utilityPaused:boot.state.pausedWorkers.includes('NV02'),
      manualCloseSuppressed:boot.state.manualCloseSuppressedWorkers.includes('NV02'),
    })).toBe('UTILITY_WORKER_PAUSED:NV02');
  });

  it('restores manual-close suppression through the Controller boot path',()=>{
    const path=join(root(),'worker-safety-state.json');
    writeWorkerSafetyState(path,{pausedWorkers:[],manualCloseSuppressedWorkers:['NV02']});
    const boot=restoreWorkerSafetyState(path);
    expect(boot.failClosed).toBe(false);
    expect(workerStartGate('NV02',{
      globalPaused:false,
      utilityPaused:boot.state.pausedWorkers.includes('NV02'),
      manualCloseSuppressed:boot.state.manualCloseSuppressedWorkers.includes('NV02'),
    })).toBe('MANUAL_CLOSE_SUPPRESSED:NV02');
  });

  it('fails closed for every worker when persisted state is corrupt',()=>{
    const path=join(root(),'worker-safety-state.json');
    writeFileSync(path,'{broken','utf8');
    const boot=restoreWorkerSafetyState(path);
    expect(boot.failClosed).toBe(true);
    expect(boot.state.pausedWorkers).toEqual([...WORKER_IDS]);
    expect(boot.state.manualCloseSuppressedWorkers).toEqual([...WORKER_IDS]);
    for(const id of WORKER_IDS){
      expect(workerStartGate(id,{
        globalPaused:false,
        utilityPaused:boot.state.pausedWorkers.includes(id),
        manualCloseSuppressed:boot.state.manualCloseSuppressedWorkers.includes(id),
      })).toBe(`UTILITY_WORKER_PAUSED:${id}`);
    }
  });

  it('recovers from a valid backup if primary is corrupt',()=>{
    const path=join(root(),'worker-safety-state.json');
    writeWorkerSafetyState(path,{pausedWorkers:['NV02'],manualCloseSuppressedWorkers:['NV03']});
    const valid=readFileSync(path,'utf8');
    writeFileSync(path+'.bak',valid,'utf8');
    writeFileSync(path,'{broken','utf8');
    const boot=restoreWorkerSafetyState(path);
    expect(boot.failClosed).toBe(false);
    expect(boot.state).toEqual({pausedWorkers:['NV02'],manualCloseSuppressedWorkers:['NV03']});
  });

  it('forces every worker gate closed when durable persistence fails',()=>{
    const path=join(root(),'worker-safety-state.json');
    const result=persistWorkerSafetyStateOrFailClosed(
      path,
      {pausedWorkers:['NV02'],manualCloseSuppressedWorkers:[]},
      ()=>{throw new Error('DISK_WRITE_FAILED');},
    );
    expect(result.failClosed).toBe(true);
    expect(String(result.error)).toContain('DISK_WRITE_FAILED');
    expect(result.state.pausedWorkers).toEqual([...WORKER_IDS]);
    expect(result.state.manualCloseSuppressedWorkers).toEqual([...WORKER_IDS]);
    for(const id of WORKER_IDS){
      expect(workerStartGate(id,{
        globalPaused:false,
        utilityPaused:result.state.pausedWorkers.includes(id),
        manualCloseSuppressed:result.state.manualCloseSuppressedWorkers.includes(id),
      })).toBe(`UTILITY_WORKER_PAUSED:${id}`);
    }
  });
});

describe('independent worker recovery flows in direct-cdp-bridge',()=>{
  const source=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');

  it('runs one continuity loop for all three configured workers with independent locks/state',()=>{
    expect(source).toContain("CONTINUITY_WORKERS.map((id)=>config.workers.find((w)=>w.id===id))");
    expect(source).toContain("workerMutationBusy.has(w.id)");
    expect(source).toContain("function loadWorkerContinuity(workerId)");
    expect(source).toContain("function saveWorkerContinuity(workerId,state)");
    expect(source).toContain("function acquireWorkerOwnership(workerId)");
    expect(source).toContain("function acquireNv02CanonicalOwnership()");
    expect(source).toContain("NV02_OWNER_LOCK");
    expect(source).toContain("NV02_DUPLICATE_CANONICAL_OWNERSHIP");
  });

  it('keeps F5 and reset timers separate and staggered per worker',()=>{
    expect(source).toContain("WORKER_F5_MIN_MS");
    expect(source).toContain("WORKER_F5_MAX_MS");
    expect(source).toContain("computeWorkerStaggerDelay");
  });

  it('fails closed on pause/security and uses bounded worker-specific planned reopen',()=>{
    expect(source).toContain("workerAutomationPaused(workerId)");
    expect(source).toContain("WORKER_AUTOMATION_PAUSE_CHECK_FAILED_CLOSED");
    expect(source).toContain("phase==='BLOCKED'");
    expect(source).toContain("WORKER_RESET_MAX_ATTEMPTS=2");
    expect(source).toContain("RECOVERY_BOUNDED_STOP");
    expect(source).toContain("/api/utility/workers/${w.id}/plan-refresh");
    expect(source).toContain("/api/utility/workers/${w.id}/safe-recover");
    expect(source.indexOf("/api/utility/workers/${w.id}/plan-refresh")).toBeLessThan(source.indexOf("await closeWorker(w,target)"));
    const reopen=source.slice(source.indexOf('async function reopenWorker'),source.indexOf('async function maybeWorkerContinuity'));
    const closePhaseEnd=reopen.indexOf("await sleep(1200)");
    expect(reopen.slice(0,closePhaseEnd)).not.toContain("/safe-recover");
    expect(reopen.indexOf("/safe-recover")).toBeGreaterThan(closePhaseEnd);
    expect(reopen).toContain("post(`/api/utility/workers/${w.id}/safe-recover`,w.id,{reason},120000)");
    expect(reopen).toContain("leaseOwnerId:lease.ownerId,leaseId:lease.leaseId");
    expect(source).toContain("resumeUrl");
  });

  it('fails closed unless READY worker still has continuable current work',()=>{
    const readyStart=source.indexOf("if(phase==='READY')");
    const readyEnd=source.indexOf("const stalledChecks=",readyStart);
    const readyBlock=source.slice(readyStart,readyEnd);
    expect(readyBlock).toContain('getControllerState()');
    expect(readyBlock).toContain('hasContinuableWorkerWork(controllerState,w.id)');
    expect(readyBlock).toContain('CONTINUABLE_WORK_CHECK_FAILED_CLOSED');
    expect(readyBlock).toContain('CONTINUE_SKIPPED_NO_CURRENT_WORK');
    expect(readyBlock.indexOf('hasContinuableWorkerWork(controllerState,w.id)')).toBeLessThan(readyBlock.indexOf('pickContinuePrompt(state.lastPrompt)'));
    expect(readyBlock.indexOf('hasContinuableWorkerWork(controllerState,w.id)')).toBeLessThan(readyBlock.indexOf("dispatch(target,prompt)"));
  });

  it('normalizes generic heartbeat phase without weakening NV02 exact-model semantics',()=>{
    const heartbeat=source.slice(source.indexOf('async function postWorkerHeartbeat'),source.indexOf('async function tickWorker'));
    expect(heartbeat).toContain("w.id==='NV02'?String(ui?.uiPhase||'STALLED'):deriveWorkerPhase(ui||{},{workerId:w.id})");
    expect(heartbeat).toContain('state:normalizedPhase');
    expect(heartbeat).toContain('uiPhase:normalizedPhase');
  });

  it('never routes NV03/NV04 through NV02-only model/project recovery',()=>{
    expect(source).toContain("if(w.id==='NV02')await maybeNv02Continuity(w,target,ui)");
    expect(source).toContain("else if(CONTINUITY_WORKERS.includes(w.id))await maybeWorkerContinuity(w,target,ui)");
    expect(source).toContain("location.hostname==='chatgpt.com'?Boolean(stop):Boolean(stop||activityBusy)");
    expect(source).toContain("function validWorkerUrl(w,url)");
  });
});

describe('safe recovery contracts',()=>{
  const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
  const broker=readFileSync('apps/chrome-controller/src/chrome-launch-broker.ts','utf8');

  it('uses tested boot/persist fail-closed helpers in Controller runtime',()=>{
    expect(server).toContain('restoreWorkerSafetyState(workerSafetyStatePath)');
    expect(server).toContain('persistWorkerSafetyStateOrFailClosed(workerSafetyStatePath,intended)');
    expect(server).toContain('applyWorkerSafetySnapshot(persisted.state)');
    expect(server).toContain('WORKER_SAFETY_STATE_PERSIST_FAIL_CLOSED');
  });

  it('makes utility pause and manual close hard gates for worker start/recovery',()=>{
    const start=server.slice(server.indexOf('async function startWorker'),server.indexOf('async function dispatch'));
    const recovery=server.slice(server.indexOf('async function recoverWorker'),server.indexOf('async function recoveryTick'));
    expect(start).toContain('workerStartGate');
    expect(recovery).toContain('utilityPausedWorkers.has(workerId)');
    expect(recovery).toContain("presence==='ABSENT'");
    expect(recovery).toContain('RECOVERY_PRESENCE_FAIL_CLOSED');
  });

  it('uses broker presence proof instead of blindly reopening stale windows',()=>{
    expect(server).toContain('/api/presence/');
    expect(broker).toContain('presenceMatch');
    expect(broker).toContain('chrome-launch-broker-state.json');
    expect(broker).toContain('Get-CimInstance Win32_Process');
    expect(broker).toContain('processProbeFromCount(undefined');
    expect(broker).toContain('WORKER_PROCESS_AMBIGUOUS');
  });

  it('fails closed before heartbeat-driven mutation for disabled workers',()=>{
    const disabled="if(!state.enabled){\n      state.status='DISABLED';";
    expect(server).toContain(disabled);
    expect(server.indexOf(disabled)).toBeLessThan(server.indexOf('const hbStop=heartbeatStopReason(hb)'));
    expect(server).not.toContain("recoveryAttempts.set(workerId,0);\n    if(!state.enabled)");
  });

  it('keeps all enabled canonical workers alive independent of backlog demand',()=>{
    const needed=server.slice(server.indexOf('function workerNeeded'),server.indexOf('async function fetchExternalSnapshot'));
    const startup=server.slice(server.indexOf('async function startupRecovery'),server.indexOf('async function handleApi'));
    expect(needed).toContain('return WORKER_IDS.includes(id)');
    expect(needed).not.toContain("if(id==='NV02')return true");
    expect(needed).not.toContain('snapshotRequiredWorkers().includes(id)||workerHasActiveJob(id)');
    expect(startup).toContain('const needed=new Set<WorkerId>(WORKER_IDS)');
    expect(startup).toContain('states.get(id)?.manualCloseSuppressed');
  });

  it('marks bridge-owned reset as planned while keeping manual close fail-closed',()=>{
    const utilityStart=server.indexOf('const utilityMatch=');
    const utility=server.slice(utilityStart,server.indexOf('const match=url.pathname.match',utilityStart));
    const windowStart=server.indexOf("if(url.pathname==='/api/window-event'");
    const windowEvent=server.slice(windowStart,server.indexOf("if(url.pathname==='/api/continuity/event'",windowStart));
    expect(utility).toContain('plan-refresh');
    expect(utility).toContain('plannedRefreshWorkers.add(workerId)');
    expect(utility).toContain('browserMutationLeases.assertOwned(workerId,leaseOwnerId,leaseId)');
    expect(utility).toContain('heartbeatStopReason(state.lastHeartbeat)');
    expect(utility).toContain('MANUAL_CLOSE_SUPPRESSED');
    expect(utility).toContain("OWNER_INTERACTION_READ_ONLY");
    expect(windowEvent).toContain('const plannedRefresh=plannedRefreshWorkers.has(workerId)');
    expect(windowEvent).toContain('state.manualCloseSuppressed=!recoveryEligible');
    expect(windowEvent).toContain('state.lastHeartbeat=undefined');
    expect(windowEvent).toContain('if(plannedRefresh)plannedRefreshWorkers.delete(workerId)');
    expect(windowEvent).toContain('if(recoveryEligible&&!plannedRefresh)void recoveryTick()');
  });

  it('keeps paused workers out of unattended start/autopilot paths',()=>{
    expect(server).toContain('START_ALL_SKIPPED_UTILITY_PAUSED');
    expect(server).toContain("if(utilityPausedWorkers.has(workerId)){setAutopilotPhase('IDLE')");
    expect(server).toContain("state.status='PAUSED'");
  });
});
