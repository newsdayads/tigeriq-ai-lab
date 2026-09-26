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

  it('keeps NV03/NV04 in an always-on local UI loop without assignment dispatching',()=>{
    expect(source).not.toContain('findContinuableWorkerWorkForUi(controllerState,w.id)');
    expect(source).toContain('LOCAL_CONTINUE_DISPATCHED');
    expect(source).toContain('pickWorkerContinuePrompt');
    const genericLoop=source.slice(source.indexOf('async function maybeWorkerContinuity'),source.indexOf('\nfunction log('));
    expect(genericLoop).toContain('chooseLocalContinuePrompt(w.id,state)');
    expect(genericLoop).not.toContain('currentWorkerAssignmentStatus');
    expect(genericLoop).not.toContain('READY_UNASSIGNED');
    expect(genericLoop).not.toContain('assignment.status');
    expect(genericLoop).toContain('awaitingWorkStart');
  });

  it('rechecks WORKING inside F5/restart mutation boundaries and never stops active work for maintenance',()=>{
    expect(source).toContain("MAINTENANCE_DEFERRED_WORKING");
    expect(source).not.toContain("PERIODIC_F5_DEFERRED_WORKING");
    const prep=source.slice(source.indexOf('async function prepareWorkerForPlannedRestart'),source.indexOf('function archiveMenuPointExpr'));
    expect(prep).not.toContain('stopStalledWorking(target)');
    const generic=source.slice(source.indexOf('async function maybeWorkerContinuity'),source.indexOf('\nfunction log('));
    expect(generic).toContain("const freshPhase=deriveWorkerPhase(fresh||{},{workerId:w.id})");
    expect(generic).toContain("freshPhase==='WORKING'||fresh?.uiBusy===true||fresh?.stopVisible===true");
    const nv02=source.slice(source.indexOf('async function maybeNv02Continuity'),source.indexOf('async function handleCommand'));
    expect(nv02).toContain('const fresh=applyNv02DurableVerifiedModelProfile(await uiState(target).catch(()=>null))');
    expect(nv02).toContain("freshPhase==='WORKING'||fresh?.uiBusy===true||fresh?.stopVisible===true");
  });

  it('uses a lightweight cached control-state endpoint instead of polling full controller state per worker',()=>{
    const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    expect(server).toContain("'/api/continuity/control-state'");
    expect(server).toContain('.filter((job)=>!job.completedAt)');
    expect(server).toContain("ownerInteractionMode:paused?'READ_ONLY':'AUTOMATION'");
    expect(server).toContain('utilityPausedWorkers:[...utilityPausedWorkers]');
    expect(source).toContain('const CONTROLLER_STATE_CACHE_MS=2000');
    expect(source).toContain('if(controllerStateFetch)return controllerStateFetch');
    expect(source).toContain("CONTROLLER+'/api/continuity/control-state'");
    expect(source).toContain('AbortSignal.timeout(3000)');
    expect(source).not.toContain("CONTROLLER+'/api/state'");
  });

  it('rearms a READY role loop if submit acknowledgement never transitions to WORKING',()=>{
    expect(source).toContain('const WORK_START_ACK_TIMEOUT_MS=90*1000');
    expect(source).toContain('awaitingWorkStartSince:Number(raw.awaitingWorkStartSince)||0');
    expect(source).toContain("'WORK_START_ACK_TIMEOUT_REARMED'");
    expect(source).toContain('now-since<WORK_START_ACK_TIMEOUT_MS');
    expect(source).toContain('awaitingWorkStartSince:now');
    expect(source).toContain('awaitingWorkStartSince:Date.now()');
  });

  it('rebases only an already-expired deep-reset timer once after bridge restart',()=>{
    expect(source).toContain("const bootResetScheduleInitialized=new Set()");
    expect(source).toContain("if(!bootResetScheduleInitialized.has(workerId)){");
    expect(source).toContain("if(nextResetAt<=now){");
    expect(source).toContain("nextResetAt=nextWorkerResetAt(workerId,now)");
    expect(source).toContain("WORKER_RESET_TIMER_REBASED_AFTER_RESTART");
    const load=source.slice(source.indexOf('function loadWorkerContinuity'),source.indexOf('function saveWorkerContinuity'));
    expect(load.indexOf("bootResetScheduleInitialized.add(workerId)")).toBeLessThan(load.indexOf("if(nextResetAt<=now)"));
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
    expect(source).toContain("resumeUrl:''");
    expect(source).toContain("WORKER_FRESH_CONTEXT_OPENED");
    expect(source).not.toContain("CURRENT_CHAT_RESTORED");

  });

  // Removed outdated READY continuation test

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
    expect(server).toContain("purpose==='CURRENT_CHAT_RESTORE'");
    expect(server).toContain("periodicF5||currentChatRestore");

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

  it('keeps bridge-triggered safe-recover non-blocking so its own heartbeat producer cannot self-wait',()=>{
    const utilityStart=server.indexOf("if(action==='safe-recover')");
    const utility=server.slice(utilityStart,server.indexOf("if(action==='archive')",utilityStart));
    expect(utility).toContain("const presence=await brokerWorkerPresence(workerId)");
    expect(utility).toContain("presence==='RUNNING'");
    expect(utility).toContain("mode:'ATTACH_EXISTING_STALE_HEARTBEAT'");
    expect(utility).toContain("mode:'BROKER_LAUNCH_REQUESTED'");
    expect(utility).toContain('await launchChrome(workerId)');
    expect(utility).not.toContain('await startWorker(workerId)');
    expect(utility).toContain('json(res,202');
  });

  it('fails closed before heartbeat-driven mutation for disabled workers',()=>{
    expect(server).toContain('state.status=\'DISABLED\'');
    expect(server.indexOf('state.status=\'DISABLED\'')).toBeLessThan(server.indexOf('const hbStop=heartbeatStopReason(hb)'));
  });

  it('selects one canonical NV03 tab and prunes idle duplicates under a mutation lease',()=>{
    const source=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(source).toContain("function preferredWorkerUrl(w)");
    expect(source).toContain("return String(w.homeUrl||'').trim()");
    expect(source).toContain("async function pruneNv03DuplicateTabs");
    expect(source).toContain("'DUPLICATE_TAB_PRUNE'");
    expect(source).toContain("rpc.call('Target.closeTarget'");
    expect(source).toContain("'DUPLICATE_TABS_PRUNED'");
    expect(source).toContain("if(w.id==='NV03'&&ui.uiBusy!==true)");
    const pruner=source.slice(source.indexOf('async function pruneNv03DuplicateTabs'),source.indexOf('async function windowIdFor'));
    expect(pruner).toContain("if(w.id!=='NV03'||!keep||ui?.uiBusy===true)return");
  });

  it('backs off worker CDP failures with bounded randomized retries before recovery',()=>{
    const source=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(source).toContain('const workerConnectivityBackoff=new Map()');
    expect(source).toContain("if(backoff&&Date.now()<Number(backoff.until||0))return");
    expect(source).toContain('if(connectivityFailure){');
    expect(source).toContain('const maxAttempts=Number(prior?.maxAttempts)||Math.floor(2+Math.random()*4)');
    expect(source).toContain('const delayMs=randomDelay(15_000,60_000)');
    expect(source).toContain("'WORKER_CONNECTIVITY_RETRY_SCHEDULED'");
    expect(source).toContain("'WORKER_CONNECTIVITY_RETRIES_EXHAUSTED'");
    expect(source).toContain("reason:'CONNECTIVITY_RETRIES_EXHAUSTED'");
    expect(source).toContain("'WORKER_CONNECTIVITY_CHROME_RESTART_REQUESTED'");
    expect(source).toContain("'WORKER_CONNECTIVITY_RECOVERY_DEFERRED'");
    expect(source).toContain("'WORKER_CONNECTIVITY_RECOVERED'");
  });

  it('retires a cancelled previous UI job so Core does not poll stale identity forever',()=>{
    const source=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    const cancelled=source.slice(source.indexOf('function reconcileCancelledUiJobFromSnapshot'),source.indexOf('async function autopilotTick'));
    expect(cancelled).toContain("lastDispatchedJobId:sameDispatched?undefined");
    expect(cancelled).toContain("lastDispatchedWorkerId:sameDispatched?undefined");
    expect(cancelled).toContain("lastDispatchedAt:sameDispatched?undefined");
    expect(cancelled).toContain("'AUTO_CONTINUE_CANCELLED_PREVIOUS_RETIRED'");
    expect(cancelled).not.toContain("'AUTO_CONTINUE_CANCELLED_PREVIOUS_RECONCILED'");
  });

  it('serializes startup recovery against the periodic recovery tick',()=>{
    const source=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    expect(source).toContain('let startupRecoveryInFlight=false');
    const tick=source.slice(source.indexOf('async function recoveryTick'),source.indexOf('async function waitForStartupRuntime'));
    expect(tick).toContain('startupRecoveryInFlight');
    const startup=source.slice(source.indexOf('async function startupRecovery'),source.indexOf('async function handleApi'));
    expect(startup).toContain('if(startupRecoveryInFlight)return');
    expect(startup).toContain('startupRecoveryInFlight=true');
    expect(startup).toContain('finally');
    expect(startup).toContain('startupRecoveryInFlight=false');
  });

  it('does not force a freshly started worker to READY over a WORKING heartbeat',()=>{
    const source=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    const start=source.slice(source.indexOf('async function startWorker'),source.indexOf('function modelProfileGateReason'));
    expect(start).toContain("const uiPhase=String(state.lastHeartbeat?.uiPhase||'').toUpperCase()");
    expect(start).toContain("state.status=['WORKING','READY','STALLED'].includes(uiPhase)?uiPhase:'ONLINE'");
    expect(start).not.toContain("state.status='READY'");
  });

  it('preserves the live heartbeat phase when reattaching workers at startup',()=>{
    const source=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    const startup=source.slice(source.indexOf('async function startupRecovery'),source.indexOf('async function handleApi'));
    expect(startup).toContain("const uiPhase=String(state.lastHeartbeat?.uiPhase||'').toUpperCase()");
    expect(startup).toContain("state.status=['WORKING','READY','STALLED'].includes(uiPhase)?uiPhase:'ONLINE'");
    expect(startup).not.toContain("states.get(id)!.status='READY'");
  });

  it('ships one canonical artifact-only installer with an exclusive deployment lock',()=>{
    const installer=readFileSync('apps/chrome-controller/runtime/Install-ApprovedArtifact.ps1','utf8');
    expect(installer).toContain("'appchrome-deploy.lock'");
    expect(installer).toContain("[IO.File]::Open($lockPath");
    expect(installer).toContain("'APPCHROME_DEPLOYMENT_LOCKED'");
    expect(installer).toContain("'active-deploy.json'");
    expect(installer).toContain("activation='SUPERVISOR_PENDING'");
    expect(installer).not.toContain('git ');
    expect(installer).not.toContain('npm ');
    expect(installer).not.toContain('npx ');
  });

  it('launches only from the verified active-deploy manifest and does not force safe-recover',()=>{
    const launcher=readFileSync('apps/chrome-controller/runtime/Start-Unified-AppChrome.ps1','utf8');
    expect(launcher).toContain("'active-deploy.json'");
    expect(launcher).toContain('ACTIVE_VERSION_MISMATCH');
    expect(launcher).toContain('ACTIVE_BRIDGE_HASH_MISMATCH');
    expect(launcher).toContain('TIGERIQ_APPROVED_HEAD');
    expect(launcher).not.toContain('/safe-recover');
    expect(launcher).not.toContain("foreach($id in @('NV02','NV03','NV04'))");
  });

  it('never F5s or reopens NV03/NV04 while WORKING; bounded stuck recovery only clicks Stop',()=>{
    const source=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const continuity=source.slice(source.indexOf('async function maybeWorkerContinuity'),source.indexOf('\nfunction log(event'));
    expect(continuity).toContain("if(Number(state.nextPeriodicF5At||0)<=now)");
    expect(continuity).toContain("if(phase!=='WORKING'&&now>=Number(state.nextResetAt||0))");
    const working=continuity.slice(continuity.indexOf("if(phase==='WORKING')"),continuity.indexOf("if(phase==='READY')"));
    expect(working).toContain("'WORKING_LONG_RUNNING_NO_MUTATION'");
    expect(working).toContain("'WORKING_LONG_RUNNING_NO_MUTATION'");
    expect(working).toContain('return;');
    expect(working).not.toContain('reopenWorker(');
    expect(working).not.toContain('reloadTarget(');
    expect(working).not.toContain('WORKING_NO_PROGRESS_3_CHECKS');
  });

  it('clears stale recovery counters immediately when NV03/NV04 are READY',()=>{
    const source=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const continuity=source.slice(source.indexOf('async function maybeWorkerContinuity'),source.indexOf('\nfunction log(event'));
    const ready=continuity.slice(continuity.indexOf("if(phase==='READY')"),continuity.indexOf("const stalledChecks="));
    expect(ready).toContain('stalledChecks:0');
    expect(ready).toContain('recoveryAttempts:0');
    expect(ready).toContain('recoveryBlockedUntil:0');
    expect(ready).toContain("'READY_RECOVERY_STATE_CLEARED'");
  });

  it('rebases stale periodic-F5 timers once after bridge restart',()=>{
    const source=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const load=source.slice(source.indexOf('function loadWorkerContinuity'),source.indexOf('function saveWorkerContinuity'));
    expect(source).toContain('const bootF5ScheduleInitialized=new Set()');
    expect(load).toContain('bootF5ScheduleInitialized.has(workerId)');
    expect(load).toContain("'WORKER_F5_TIMER_REBASED_AFTER_RESTART'");
    expect(load).toContain('nextPeriodicF5At=nextRandomAt(now,WORKER_F5_MIN_MS,WORKER_F5_MAX_MS)');
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

  it('keeps bridge-owned planned refresh exclusive until heartbeat reattaches or bounded deadline expires',()=>{
    const utilityStart=server.indexOf('const utilityMatch=');
    const utility=server.slice(utilityStart,server.indexOf('const match=url.pathname.match',utilityStart));
    const heartbeatStart=server.indexOf("if(url.pathname==='/api/heartbeat'");
    const heartbeat=server.slice(heartbeatStart,server.indexOf("if(url.pathname==='/api/window-event'",heartbeatStart));
    const windowStart=server.indexOf("if(url.pathname==='/api/window-event'");
    const windowEvent=server.slice(windowStart,server.indexOf("if(url.pathname==='/api/continuity/event'",windowStart));
    const recoverStart=server.indexOf('async function recoverWorker');
    const recover=server.slice(recoverStart,server.indexOf('async function recoveryTick',recoverStart));
    expect(server).toContain('const plannedRefreshDeadlines = new Map<WorkerId,number>()');
    expect(server).toContain('function markPlannedRefresh(workerId:WorkerId)');
    expect(server).toContain("clearPlannedRefresh(workerId,'DEADLINE_EXPIRED')");
    expect(utility).toContain('plan-refresh');
    expect(utility).toContain('markPlannedRefresh(workerId)');
    expect(utility).toContain('browserMutationLeases.assertOwned(workerId,leaseOwnerId,leaseId)');
    expect(utility).toContain('heartbeatStopReason(state.lastHeartbeat)');
    expect(utility).toContain('MANUAL_CLOSE_SUPPRESSED');
    expect(utility).toContain("OWNER_INTERACTION_READ_ONLY");
    expect(heartbeat).toContain("clearPlannedRefresh(workerId,'HEARTBEAT_REATTACHED')");
    expect(windowEvent).toContain('const plannedRefresh=plannedRefreshInFlight(workerId)');
    expect(windowEvent).toContain('state.manualCloseSuppressed=!recoveryEligible');
    expect(windowEvent).toContain('state.lastHeartbeat=undefined');
    expect(windowEvent).not.toContain('plannedRefreshWorkers.delete(workerId)');
    expect(windowEvent).toContain('if(recoveryEligible&&!plannedRefresh)void recoveryTick()');
    expect(recover).toContain('if(plannedRefreshInFlight(workerId))');
    expect(recover).toContain("'RECOVERY_DEFERRED_PLANNED_REFRESH'");
  });

  it('waits bounded time for a running Chrome process to reattach heartbeat instead of relaunch racing it',()=>{
    const start=server.slice(server.indexOf('async function startWorker'),server.indexOf('function modelProfileGateReason'));
    expect(start).toContain("if(presence==='RUNNING')");
    expect(start).toContain("state.status='WAITING_HEARTBEAT_ATTACH'");
    expect(start).toContain('const attached=await waitForStartupAttach(workerId)');
    expect(start).toContain("'WORKER_RUNNING_HEARTBEAT_REATTACHED'");
    expect(start).toContain('WORKER_RUNNING_WITHOUT_HEARTBEAT');
  });

  it('requires a post-reload confirmation grace before generic STALLED reopen',()=>{
    const source=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const continuity=source.slice(source.indexOf('async function maybeWorkerContinuity'),source.indexOf('\nfunction log(event'));
    expect(source).toContain('const STALLED_CONFIRM_GRACE_MS=20*1000');
    expect(continuity).toContain("if(phase==='STALLED'&&Number(state.recoveryBlockedUntil||0)>now)");
    expect(continuity).toContain('const confirmAfter=Date.now()+STALLED_CONFIRM_GRACE_MS');
    expect(continuity).toContain('recoveryBlockedUntil:confirmAfter');
    expect(continuity).toContain("'STALLED_RELOAD'");
  });

  it('keeps paused workers out of unattended start/autopilot paths',()=>{
    expect(server).toContain('START_ALL_SKIPPED_UTILITY_PAUSED');
    expect(server).toContain("if(utilityPausedWorkers.has(workerId)){setAutopilotPhase('IDLE')");
    expect(server).toContain("state.status='PAUSED'");
  });
});
