import { execFileSync } from 'node:child_process';
import { copyFileSync,existsSync,mkdtempSync,readFileSync,readdirSync,renameSync,unlinkSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ts from 'typescript';
import { describe,expect,it } from 'vitest';
import { DurableDispatchLeaseStore } from '../apps/chrome-controller/src/dispatch-lease.js';
import { canResetOrphanUnpersistedDispatch,classifyAutoContinueDispatchFailure,decideAutoContinue,freshAutopilotState,sourceStillOffersPendingJob,type DurableAutopilotState,type ExternalAutopilotSnapshot } from '../apps/chrome-controller/src/autopilot.js';
import { heartbeatStopReason } from '../apps/chrome-controller/src/security-gate.js';
import { atomicWriteJsonWithRetry, persistRuntimeEvidenceJson, type AtomicJsonFileOps } from '../apps/chrome-controller/src/runtime-evidence.js';

const observedAt='2026-09-17T00:00:10.000Z';
const completedAt='2026-09-17T00:00:05.000Z';
const verifiedAt='2026-09-17T00:00:09.000Z';
const now=Date.parse(observedAt);
const dispatchedState=():DurableAutopilotState=>({...freshAutopilotState(),lastDispatchedJobId:'GH-1',lastDispatchedAt:'2026-09-17T00:00:01.000Z'});
function snapshot(riskFlags:string[]=[]):ExternalAutopilotSnapshot{return{
  source:'CORE',observedAt,revision:'core-ui-v1:test',
  previousJob:{jobId:'GH-1',workerId:'NV02',status:'DONE',executable:true,priority:'P0',completedAt,completionRevision:'closure-1',evidence:[{source:'GITHUB',ref:'https://github.com/x/1',verifiedAt,jobId:'GH-1',completedAt,completionRevision:'closure-1'}]},
  nextJob:{jobId:'GH-2',workerId:'NV02',status:'READY',executable:true,priority:'P0',prompt:'safe',riskFlags,issueRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/2',coreSelected:true},requiredWorkers:['NV02'],
};}

describe('durable dispatch lease',()=>{
  it('suppresses a committed job across controller instances',()=>{
    const dir=mkdtempSync(join(tmpdir(),'tigeriq-lease-'));const path=join(dir,'lease.json');
    const a=new DurableDispatchLeaseStore(path,'controller-a',60_000);const b=new DurableDispatchLeaseStore(path,'controller-b',60_000);
    const acquired=a.acquire('GH-1',1000);expect(acquired.kind).toBe('ACQUIRED');if(acquired.kind!=='ACQUIRED')return;
    a.markDispatching(acquired.lease.leaseId,'GH-1',2000);a.markCommitted(acquired.lease.leaseId,'GH-1',3000);
    expect(b.acquire('GH-1',4000)).toMatchObject({kind:'COMMITTED',lease:{jobId:'GH-1',state:'COMMITTED',leaseEpoch:1}});
    expect(b.acquire('GH-2',4000)).toMatchObject({kind:'TAKEN_OVER',lease:{jobId:'GH-2',leaseEpoch:2}});
  });

  it('reconciles reserved pending dispatch before bounded takeover',()=>{
    const dir=mkdtempSync(join(tmpdir(),'tigeriq-lease-'));const path=join(dir,'lease.json');
    const a=new DurableDispatchLeaseStore(path,'controller-a',60_000);const b=new DurableDispatchLeaseStore(path,'controller-b',60_000);
    expect(a.acquire('GH-1',1000).kind).toBe('ACQUIRED');
    expect(b.reconcilePending('GH-1',30_000).kind).toBe('WAIT');
    expect(b.reconcilePending('GH-1',62_000).kind).toBe('SAFE_RETRY');
    expect(b.acquire('GH-2',62_000)).toMatchObject({kind:'TAKEN_OVER',lease:{leaseEpoch:2,takeoverOf:expect.any(String)}});
  });

  it('never removes the authoritative lease while recovering a stale takeover lock',()=>{
    const dir=mkdtempSync(join(tmpdir(),'tigeriq-lease-'));const path=join(dir,'lease.json');
    const a=new DurableDispatchLeaseStore(path,'controller-a',60_000);const b=new DurableDispatchLeaseStore(path,'controller-b',60_000);
    const first=a.acquire('GH-1',1000);expect(first.kind).toBe('ACQUIRED');
    writeFileSync(`${path}.takeover.lock`,JSON.stringify({schemaVersion:'tigeriq.chrome-controller.takeover-lock.v1',lockId:'dead-lock',ownerId:'dead',acquiredAt:'1970-01-01T00:00:10.000Z',expiresAt:'1970-01-01T00:00:50.000Z'}));
    expect(existsSync(path)).toBe(true);
    const takeover=b.acquire('GH-2',62_000);
    expect(existsSync(path)).toBe(true);
    expect(takeover).toMatchObject({kind:'TAKEN_OVER',lease:{jobId:'GH-2',leaseEpoch:2}});
  });

  it('keeps the old lease authoritative while a takeover lock is still live, then recovers after lock expiry',()=>{
    const dir=mkdtempSync(join(tmpdir(),'tigeriq-lease-'));const path=join(dir,'lease.json');
    const a=new DurableDispatchLeaseStore(path,'controller-a',60_000);const b=new DurableDispatchLeaseStore(path,'controller-b',60_000);
    const first=a.acquire('GH-1',1000);expect(first.kind).toBe('ACQUIRED');
    const oldLease=readFileSync(path,'utf8');
    writeFileSync(`${path}.takeover.lock`,JSON.stringify({schemaVersion:'tigeriq.chrome-controller.takeover-lock.v1',lockId:'live-lock',ownerId:'dead',acquiredAt:'1970-01-01T00:01:00.000Z',expiresAt:'1970-01-01T00:01:10.000Z'}));
    expect(b.acquire('GH-2',65_000)).toMatchObject({kind:'BUSY'});
    expect(readFileSync(path,'utf8')).toBe(oldLease);
    expect(b.acquire('GH-2',71_000)).toMatchObject({kind:'TAKEN_OVER',lease:{jobId:'GH-2',leaseEpoch:2}});
  });

  it('fails closed instead of taking over an in-flight dispatch',()=>{
    const dir=mkdtempSync(join(tmpdir(),'tigeriq-lease-'));const path=join(dir,'lease.json');
    const a=new DurableDispatchLeaseStore(path,'controller-a',60_000);const b=new DurableDispatchLeaseStore(path,'controller-b',60_000);
    const acquired=a.acquire('GH-1',1000);if(acquired.kind!=='ACQUIRED')throw new Error('setup');a.markDispatching(acquired.lease.leaseId,'GH-1',2000);
    expect(b.reconcilePending('GH-1',63_000)).toMatchObject({kind:'UNCERTAIN',reason:'DISPATCH_INFLIGHT_STALE:GH-1'});
    expect(b.acquire('GH-2',63_000)).toMatchObject({kind:'UNCERTAIN',reason:'DISPATCH_INFLIGHT_STALE:GH-1'});
  });
  it('returns known non-delivery to RESERVED with a bounded retry delay',()=>{
    const dir=mkdtempSync(join(tmpdir(),'tigeriq-lease-'));const path=join(dir,'lease.json');
    const a=new DurableDispatchLeaseStore(path,'controller-a',60_000);const b=new DurableDispatchLeaseStore(path,'controller-b',60_000);
    const acquired=a.acquire('GH-1',1000);if(acquired.kind!=='ACQUIRED')throw new Error('setup');
    a.markDispatching(acquired.lease.leaseId,'GH-1',2000);
    expect(a.markRetryable(acquired.lease.leaseId,'GH-1',3000)).toMatchObject({state:'RESERVED',expiresAt:'1970-01-01T00:01:03.000Z'});
    expect(b.acquire('GH-1',4000)).toMatchObject({kind:'BUSY'});
    expect(b.acquire('GH-1',63_001)).toMatchObject({kind:'TAKEN_OVER',lease:{jobId:'GH-1',leaseEpoch:2}});
  });
  it('retires withdrawn noncommitted work without treating it as delivered',()=>{
    const dir=mkdtempSync(join(tmpdir(),'tigeriq-lease-'));const path=join(dir,'lease.json');
    const a=new DurableDispatchLeaseStore(path,'controller-a',60_000);const b=new DurableDispatchLeaseStore(path,'controller-b',60_000);
    const acquired=a.acquire('GH-1',1000);if(acquired.kind!=='ACQUIRED')throw new Error('setup');
    a.markDispatching(acquired.lease.leaseId,'GH-1',2000);
    expect(b.retireNoLongerExecutable('GH-1',3000)).toMatchObject({jobId:'GH-1',state:'RESERVED',expiresAt:'1970-01-01T00:00:03.000Z',leaseEpoch:2});
    expect(b.acquire('GH-2',3001)).toMatchObject({kind:'TAKEN_OVER',lease:{jobId:'GH-2',leaseEpoch:3}});
  });});

describe('crash-safe atomic persistence',()=>{
  const errorWithCode=(code:string)=>Object.assign(new Error(code),{code});
  const ops=(rename:(from:string,to:string)=>void,tempId:string):AtomicJsonFileOps=>({
    write:(path,content)=>writeFileSync(path,content,'utf8'),rename,exists:existsSync,unlink:unlinkSync,sleep:()=>{},tempId:()=>tempId,
  });

  it('retries transient EPERM/EBUSY and eventually replaces the last-good file',()=>{
    const dir=mkdtempSync(join(tmpdir(),'tigeriq-evidence-'));const path=join(dir,'runtime-evidence.json');
    writeFileSync(path,'{"generation":"last-good"}\n','utf8');let attempts=0;
    atomicWriteJsonWithRetry(path,{generation:'new'},ops((from,to)=>{attempts++;if(attempts===1)throw errorWithCode('EPERM');if(attempts===2)throw errorWithCode('EBUSY');renameSync(from,to);},'retry-success'));
    expect(attempts).toBe(3);expect(JSON.parse(readFileSync(path,'utf8'))).toEqual({generation:'new'});
  });

  it('preserves last-good evidence and removes the unique temp after persistent EBUSY',()=>{
    const dir=mkdtempSync(join(tmpdir(),'tigeriq-evidence-'));const path=join(dir,'runtime-evidence.json');
    const lastGood='{"generation":"last-good"}\n';writeFileSync(path,lastGood,'utf8');
    expect(()=>atomicWriteJsonWithRetry(path,{generation:'never-written'},ops(()=>{throw errorWithCode('EBUSY');},'persistent-busy'),3)).toThrow('EBUSY');
    expect(readFileSync(path,'utf8')).toBe(lastGood);
    expect(readdirSync(dir).filter((name)=>name.endsWith('.tmp'))).toEqual([]);
  });

  it('uses a verified copy fallback for non-authoritative runtime evidence after persistent Windows EPERM',()=>{
    const dir=mkdtempSync(join(tmpdir(),'tigeriq-evidence-'));const path=join(dir,'runtime-evidence.json');
    writeFileSync(path,'{"generation":"last-good"}\n','utf8');let attempts=0;
    const custom:AtomicJsonFileOps={
      ...ops(()=>{attempts++;throw errorWithCode('EPERM');},'copy-fallback'),
      copy:(from,to)=>copyFileSync(from,to),
      read:(file)=>readFileSync(file,'utf8'),
    };
    const result=persistRuntimeEvidenceJson(path,{generation:'fallback'},custom);
    expect(attempts).toBe(9);expect(result).toEqual({mode:'COPY_FALLBACK',code:'EPERM'});
    expect(JSON.parse(readFileSync(path,'utf8'))).toEqual({generation:'fallback'});
    expect(JSON.parse(readFileSync(`${path}.last-good`,'utf8'))).toEqual({generation:'last-good'});
  });

  it('holds a serialization lock for the complete atomic replace transaction',()=>{
    const dir=mkdtempSync(join(tmpdir(),'tigeriq-evidence-'));const path=join(dir,'runtime-evidence.json');
    let lockHeld=false,released=false,renameSawLock=false;
    const custom:AtomicJsonFileOps={
      ...ops((from,to)=>{renameSawLock=lockHeld;renameSync(from,to);},'serialized'),
      acquireLock:()=>{expect(lockHeld).toBe(false);lockHeld=true;return()=>{lockHeld=false;released=true;};},
    };
    atomicWriteJsonWithRetry(path,{generation:'serialized'},custom);
    expect(renameSawLock).toBe(true);expect(released).toBe(true);expect(lockHeld).toBe(false);
  });
});

describe('withdrawn pending source contract',()=>{
  it('keeps pending executable only while a trusted Core or NV02 fallback authority offers the exact assigned UI job',()=>{
    const s=snapshot();
    expect(sourceStillOffersPendingJob(s,'GH-2')).toBe(true);
    const fallback={...s,source:'GITHUB' as const,authority:'NV02_OWNER_PROXY_FALLBACK' as const,nextJob:{...s.nextJob!,coreSelected:false}};
    expect(sourceStillOffersPendingJob(fallback,'GH-2')).toBe(true);
    const badFallback={...fallback,nextJob:{...fallback.nextJob!,workerId:'NV03' as const}};
    expect(sourceStillOffersPendingJob(badFallback,'GH-2')).toBe(false);
    expect(sourceStillOffersPendingJob(s,'GH-X')).toBe(false);
    const none={...s,nextJob:undefined};expect(sourceStillOffersPendingJob(none,'GH-2')).toBe(false);
    const cancelled={...s,nextJob:{...s.nextJob!,status:'CANCELLED' as const,executable:false}};expect(sourceStillOffersPendingJob(cancelled,'GH-2')).toBe(false);
  });
  it('wires source withdrawal into terminal local cleanup before any retry',()=>{
    const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    expect(server).toContain('sourceStillOffersPendingJob(latestSnapshot,pendingJobId)');
    expect(server).toContain('const workerId=decision.workerId');
    expect(server).toContain("await dispatch(workerId,decision.text,false,'AUTO_CONTINUE'");
    expect(server).toContain("const uncertainWorkerId=autopilotState.uncertainWorkerId??autopilotState.lastDispatchedWorkerId");
    expect(server).toContain("uiJobLedger.get(uncertainWorkerId,uncertain)");
    expect(server).toContain("blocker:'SOURCE_JOB_NO_LONGER_EXECUTABLE'");
    expect(server).toContain('dispatchLease.retireNoLongerExecutable(pendingJobId,Date.now())');
    expect(server).toContain("log('AUTO_CONTINUE_PENDING_SOURCE_WITHDRAWN'");
  });
});

describe('fresh completion evidence',()=>{
  it('requires durable proof of the exact prior dispatch and completion after it',()=>{
    expect(decideAutoContinue(snapshot(),dispatchedState(),now)).toMatchObject({kind:'DISPATCH',jobId:'GH-2',workerId:'NV02'});
    const nv03=snapshot();nv03.nextJob={...nv03.nextJob!,workerId:'NV03',coreSelected:true};nv03.requiredWorkers=['NV03'];
    expect(decideAutoContinue(nv03,dispatchedState(),now)).toMatchObject({kind:'DISPATCH',jobId:'GH-2',workerId:'NV03'});
    const fallback=snapshot();fallback.source='GITHUB';fallback.authority='NV02_OWNER_PROXY_FALLBACK';fallback.nextJob={...fallback.nextJob!,coreSelected:false};
    expect(decideAutoContinue(fallback,dispatchedState(),now)).toMatchObject({kind:'DISPATCH',jobId:'GH-2',workerId:'NV02'});
    const fallbackNv03={...fallback,nextJob:{...fallback.nextJob!,workerId:'NV03' as const}};
    expect(decideAutoContinue(fallbackNv03,dispatchedState(),now)).toMatchObject({kind:'STOP',reason:'NEXT_JOB_NOT_TRUSTED_SELECTION'});
    const legacy=snapshot();legacy.source='GITHUB';legacy.nextJob={...legacy.nextJob!,coreSelected:false};
    expect(decideAutoContinue(legacy,dispatchedState(),now)).toMatchObject({kind:'STOP',reason:'NEXT_JOB_NOT_TRUSTED_SELECTION'});
    expect(decideAutoContinue(snapshot(),freshAutopilotState(),now)).toMatchObject({kind:'WAIT_EVIDENCE'});
    expect(decideAutoContinue(snapshot(),{...freshAutopilotState(),lastDispatchedJobId:'GH-1'},now)).toMatchObject({kind:'WAIT_EVIDENCE'});
    const wrong=snapshot();wrong.previousJob!.evidence![0].jobId='GH-X';expect(decideAutoContinue(wrong,dispatchedState(),now)).toMatchObject({kind:'WAIT_EVIDENCE'});
    const old=snapshot();old.previousJob!.completedAt='2026-09-17T00:00:00.000Z';old.previousJob!.evidence![0].completedAt='2026-09-17T00:00:00.000Z';expect(decideAutoContinue(old,dispatchedState(),now)).toMatchObject({kind:'WAIT_EVIDENCE'});
    const cancelled=snapshot();cancelled.previousJob={...cancelled.previousJob!,status:'CANCELLED',executable:false,evidence:undefined,completedAt:undefined,completionRevision:undefined};
    expect(decideAutoContinue(cancelled,dispatchedState(),now)).toMatchObject({kind:'DISPATCH',jobId:'GH-2',workerId:'NV02'});
    const cancelledNoNext={...cancelled,nextJob:undefined};
    expect(decideAutoContinue(cancelledNoNext,dispatchedState(),now)).toMatchObject({kind:'IDLE',reason:'NO_EXECUTABLE_JOB'});
  });
});

describe('security fail-closed matrix',()=>{
  it('maps every auth/challenge/rate-limit heartbeat signal to a stop reason',()=>{
    expect(heartbeatStopReason({authRequired:true})).toBe('AUTH_REQUIRED');
    expect(heartbeatStopReason({reauthRequired:true})).toBe('REAUTH');
    expect(heartbeatStopReason({captchaRequired:true})).toBe('CAPTCHA');
    expect(heartbeatStopReason({rateLimited:true})).toBe('RATE_LIMIT_429');
    expect(heartbeatStopReason({rateLimitCode:429})).toBe('RATE_LIMIT_429');
    expect(heartbeatStopReason({securityBlock:'BLOCKED_CAPTCHA'})).toBe('CAPTCHA');
    expect(heartbeatStopReason({securityBlock:'BLOCKED_REAUTH'})).toBe('REAUTH');
    expect(heartbeatStopReason({securityBlock:'BLOCKED_RATE_LIMIT'})).toBe('RATE_LIMIT_429');
  });
  it('stops AUTO_CONTINUE for all equivalent risk flags',()=>{
    for(const flag of ['AUTH_REQUIRED','REAUTH','CAPTCHA','RATE_LIMIT','RATE_LIMIT_429','HTTP_429']){
      expect(decideAutoContinue(snapshot([flag]),dispatchedState(),now)).toMatchObject({kind:'STOP',reason:`RISK_FLAG_${flag}`});
    }
  });
});

describe('controller-independent Chrome lifecycle contract',()=>{
  it('keeps Chrome spawn only in detached broker helper, never in Controller',()=>{
    const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    const broker=readFileSync('apps/chrome-controller/src/chrome-launch-broker.ts','utf8');
    const lifecycle=readFileSync('apps/chrome-controller/src/process-lifecycle.ts','utf8');
    expect(server).not.toContain('spawn(');
    expect(server).toContain('launchBrokerUrl');
    expect(broker).toContain('spawnDetachedProcess');
    expect(lifecycle).toContain('detached:true');
    expect(lifecycle).toContain('child.unref()');
  });
});

describe('NV02 restart schedule WORKING safety',()=>{
  it('forbids restart while NV02 is busy and rejects the legacy stale-working reason',()=>{
    const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    expect(server).toContain("if(reason==='WORKING_NO_PROGRESS_3_CHECKS')throw new Error('NV02_WORKING_RESTART_FORBIDDEN')");
    expect(server).toContain("if(state.lastHeartbeat?.uiBusy!==false)throw new Error('NV02_UI_NOT_IDLE')");
    expect(server).not.toContain("NV02_STALE_WORKING_RESTART_REQUIRES_BUSY");
    expect(server).toContain("NV02_COMMAND_INFLIGHT");
    expect(server).toContain("heartbeatStopReason(state.lastHeartbeat)");
  });
});

describe('isolated NV02 WORKING/F5 safety scope',()=>{
  it('never F5s, reopens, sends, or rotates while WORKING but may stop a proven stuck generation',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(bridge).not.toContain("'STALE_WORKING_RECOVERY'");
    expect(bridge).not.toContain("'WORKING_STALLED_REOPEN_SCHEDULED'");
    expect(bridge).not.toContain("reason:'WORKING_NO_PROGRESS_3_CHECKS'");
    expect(bridge).not.toContain("stopAndClearComposerExpr");
    const hotLoop=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    const working=hotLoop.slice(hotLoop.indexOf("if(phase==='WORKING')"),hotLoop.indexOf('const chatLoadRecoveryHandled=await maybeRecoverChatLoadError'));
    expect(working).not.toContain('reloadTarget');
    expect(hotLoop).toContain("if(phase!=='WORKING'&&now>=Number(state.nextRefreshAt||0))");
    expect(hotLoop).toContain("if(now>=Number(state.nextPeriodicF5At||0))");
    expect(working).not.toContain('reopenWorker(');
    expect(working).not.toContain('dispatchNaturalContinue');
    expect(working).toContain("'WORKING_LONG_RUNNING_NO_MUTATION'");
    expect(working).toContain('return;');
    expect(working).toContain("return;");
  });

  it('continues locally when READY without any Core assignment gate', () => {
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const hotLoop=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    expect(hotLoop).not.toContain("currentWorkerAssignmentStatus('NV02')");
    expect(hotLoop).not.toContain('READY_UNASSIGNED');
    expect(hotLoop).toContain("if(phase==='READY')");
    expect(hotLoop).toContain('dispatchNaturalContinue(target,state,now)');
    expect(hotLoop).toContain('awaitingWorkStart');
    expect(hotLoop).not.toContain('CURRENT_WORK_NEW_CHAT_RESTORE');
  });
});

describe('Direct CDP live dispatch hardening',()=>{
  it('avoids duplicate prompt text and requires positive submit evidence on the live executor',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(bridge).toContain('composerText(c)!==expected');
    expect(bridge).toContain('button[type=\\"submit\\"]');
    expect(bridge).toContain("status:'SUBMIT_EVIDENCE_MISSING'");
    expect(bridge).toContain("status:'SUBMITTED',evidence:'UI_BUSY'");
    expect(bridge).toContain("status:'SUBMITTED',evidence:'USER_MESSAGE_VISIBLE'");
    expect(bridge).toContain("status:'SUBMITTED',evidence:'COMPOSER_CLEARED'");
  });
});

describe('AUTO_CONTINUE current-chat dispatch contract',()=>{
  it('does not navigate to project home before dispatching the queued job',()=>{
    const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    expect(server).toContain("await dispatch(workerId,decision.text,false,'AUTO_CONTINUE',{jobId:decision.jobId");
    expect(server).not.toContain("await dispatch(workerId,decision.text,true,'AUTO_CONTINUE')");
    expect(server).toContain("await dispatch(workerId,data.text,data.navigate!==false,'MANUAL',{");
  });
});
describe('AUTO_CONTINUE known non-delivery contract',()=>{
  it('classifies every explicit pre-submit failure as safe retry',()=>{
    for(const error of [
      new Error('COMMAND_TIMEOUT_NOT_DELIVERED:DISPATCH:NV02'),
      new Error('COMPOSER_NOT_FOUND'),
      new Error('SEND_BUTTON_NOT_FOUND'),
    ]) expect(classifyAutoContinueDispatchFailure(error,false)).toBe('SAFE_RETRY');
  });

  it('keeps ambiguous or submitted failures fail-closed',()=>{
    for(const error of [
      new Error('COMMAND_TIMEOUT_DELIVERED:DISPATCH:NV02'),
      new Error('DISPATCH_FAILED'),
      new Error('NETWORK_AFTER_CLICK'),
    ]) expect(classifyAutoContinueDispatchFailure(error,false)).toBe('UNCERTAIN');
    expect(classifyAutoContinueDispatchFailure(new Error('COMPOSER_NOT_FOUND'),true)).toBe('UNCERTAIN');
  });

  it('wires the classifier into AUTO_CONTINUE while preserving manual dispatch configuration',()=>{
    const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    expect(server).toContain('classifyAutoContinueDispatchFailure(error,dispatchDelivered)');
    expect(server).toContain('dispatchLease.resetKnownNotDelivered(decision.jobId,Date.now(),0)');
    expect(server).toContain("log('AUTO_CONTINUE_FAILED_CLOSED'");
    expect(server).toContain("await dispatch(workerId,data.text,data.navigate!==false,'MANUAL',{");
  });
});

describe('orphan pre-dispatch recovery proof',()=>{
  const lease=(state:'RESERVED'|'DISPATCHING'|'COMMITTED',expiresAt:string,jobId='GH-1042')=>({
    schemaVersion:'tigeriq.chrome-controller.dispatch-lease.v3' as const,
    leaseId:'lease-1',leaseEpoch:1,ownerId:'old-controller',jobId,state,
    acquiredAt:'2026-09-19T05:59:49.105Z',heartbeatAt:'2026-09-19T05:59:49.111Z',expiresAt,
  });
  it('allows safe reset only when the matching DISPATCHING lease is expired and no durable ledger record exists',()=>{
    const now=Date.parse('2026-09-19T06:07:00Z');
    expect(canResetOrphanUnpersistedDispatch('GH-1042',false,lease('DISPATCHING','2026-09-19T06:04:49Z'),now)).toBe(true);
    expect(canResetOrphanUnpersistedDispatch('GH-1042',true,lease('DISPATCHING','2026-09-19T06:04:49Z'),now)).toBe(false);
    expect(canResetOrphanUnpersistedDispatch('GH-1042',false,lease('DISPATCHING','2026-09-19T06:10:00Z'),now)).toBe(false);
    expect(canResetOrphanUnpersistedDispatch('GH-1042',false,lease('COMMITTED','2026-09-19T06:04:49Z'),now)).toBe(false);
    expect(canResetOrphanUnpersistedDispatch('GH-1042',false,lease('DISPATCHING','2026-09-19T06:04:49Z','GH-X'),now)).toBe(false);
  });
  it('preserves ordering invariant: durable ledger transition happens before any browser command is queued',()=>{
    const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    const ledgerCreate=server.indexOf('uiJobLedger.create');
    const ledgerDispatching=server.indexOf("uiJobLedger.transition(workerId,job.jobId,'DISPATCHING'");
    const command=server.indexOf("sendCommand(workerId,'DISPATCH'");
    expect(ledgerCreate).toBeGreaterThan(-1);
    expect(ledgerDispatching).toBeGreaterThan(ledgerCreate);
    expect(command).toBeGreaterThan(ledgerDispatching);
  });
});

describe('AUTO_CONTINUE continuity recovery',()=>{
  it('treats a pre-submit active-ledger collision as known non-delivery',()=>{
    expect(classifyAutoContinueDispatchFailure(new Error('UI_JOB_ACTIVE:NV02:GH-1005'),false)).toBe('SAFE_RETRY');
    expect(classifyAutoContinueDispatchFailure(new Error('UI_JOB_DUPLICATE_ACTIVE:NV02:GH-1010'),false)).toBe('SAFE_RETRY');
    expect(classifyAutoContinueDispatchFailure(new Error('UI_JOB_ACTIVE:NV02:GH-1005'),true)).toBe('UNCERTAIN');
  });

  it('can reset a provably not-delivered dispatch lease across controller instances',()=>{
    const dir=mkdtempSync(join(tmpdir(),'tigeriq-lease-'));const path=join(dir,'lease.json');
    const a=new DurableDispatchLeaseStore(path,'controller-a',60_000);
    const b=new DurableDispatchLeaseStore(path,'controller-b',60_000);
    const acquired=a.acquire('GH-1010',1000);if(acquired.kind!=='ACQUIRED')throw new Error('setup');
    a.markDispatching(acquired.lease.leaseId,'GH-1010',2000);
    expect(b.resetKnownNotDelivered('GH-1010',3000,0)).toMatchObject({
      jobId:'GH-1010',state:'RESERVED',ownerId:'controller-b',leaseEpoch:2,
      expiresAt:'1970-01-01T00:00:03.000Z',
    });
  });

  it('wires authoritative completion reconciliation and a supported manual fallback',()=>{
    const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    expect(server).toContain('reconcileCompletedUiJobFromSnapshot');
    expect(server).toContain('UI_JOB_EXTERNAL_COMPLETION_RECONCILED');
    expect(server).toContain("/api/autopilot/continue-now");
    expect(server).toContain('AUTOPILOT_UNCERTAIN_POSSIBLY_DELIVERED');
    expect(server).toContain('resetKnownNotDelivered');
  });
});


describe('App Chrome local-only coordination',()=>{
  it('keeps Controller as local command transport and disables external assignment ownership',()=>{
    const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    expect(server).toContain('const externalWorkAutopilotEnabled=false');
    expect(server).toContain("sendCommand(workerId,'LOCAL_CONTINUE_NOW')");
    expect(server).toContain("UTILITY_LOCAL_CONTINUE_NOW");
    expect(server).toContain("for(let attempt=1;attempt<=3;attempt+=1)");
    expect(server).toContain("if(result?.status!=='LOCAL_CONTINUE_DEFERRED')break");
    expect(server).toContain("if(attempt<3)await delay(2500)");
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const loop=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    expect(loop).not.toContain('externalAutopilotOwnsNextNv02Job');
    expect(loop).not.toContain('findContinuableNv02Work');
    expect(loop).toContain('dispatchNaturalContinue(target,state,now)');
    expect(bridge).toContain("continuityEvent('LOCAL_CONTINUE_DISPATCHED'");
    expect(bridge).toContain("acquireBridgeMutationLease('NV02',purpose,ttlMs)");
    const handleCommandSource=bridge.slice(bridge.indexOf('async function handleCommand'),bridge.indexOf('async function postWorkerHeartbeat'));
    const localRun=handleCommandSource.slice(handleCommandSource.indexOf("if(action==='LOCAL_CONTINUE_NOW')"),handleCommandSource.indexOf("if(action==='DISPATCH')"));
    expect(localRun).not.toContain("withNv02Mutation(");
    expect(localRun).toContain("ensureNv02LocalReadyLocked(target,raw,{forceFresh:false})");
    expect(localRun).toContain("rearmWorkerRunGrace(workerRunGraceUntil.get('NV02'),submittedAt,LOCAL_RUN_GRACE_MS)");
    expect(localRun).toContain("LOCAL_RUN_SUBMISSION_GRACE_REARMED");
    expect(localRun.indexOf('dispatchNaturalContinueLocked')).toBeLessThan(localRun.indexOf('LOCAL_RUN_SUBMISSION_GRACE_REARMED'));
    expect(bridge).toContain("LOCAL_RUN_BACKGROUND_SUPPRESSED");
  });
});


describe('GitHub terminal UI-job reconciliation #1843',()=>{
  it('reconciles closed same-repo issueRefs independently of disabled autopilot/self-run',()=>{
    const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    const start=server.indexOf('async function reconcileGithubTerminalUiJobs()');
    const end=server.indexOf('async function selfRunTick()',start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const reconcile=server.slice(start,end);
    expect(reconcile).toContain("['SUBMITTED','WORKING','WAITING_EVIDENCE','VERIFY'].includes(active.stage)");
    expect(reconcile).toContain("active.source==='APP_CHROME_SELF_RUN'");
    expect(reconcile).toContain('await reconcileSelfRunWorker(workerId)');
    expect(reconcile).toContain('fetchGithubIssue');
    expect(reconcile).toContain('active=uiJobLedger.active(workerId)');
    expect(reconcile).toContain('active.jobId!==jobId');
    expect(reconcile).toContain("'WAITING_EVIDENCE'");
    expect(reconcile).toContain("'VERIFY'");
    expect(reconcile).toContain("'DONE'");
    expect(reconcile).toContain("'BLOCKED'");
    expect(reconcile).toContain('UI_JOB_GITHUB_TERMINAL_RECONCILED');
    expect(reconcile).toContain('UI_JOB_GITHUB_TERMINAL_RECONCILE_DEFERRED');
    expect(reconcile).not.toContain('externalWorkAutopilotEnabled');
    expect(reconcile).not.toContain('if(!selfRunEnabled)');
    expect(server).toContain('void reconcileGithubTerminalUiJobs()');
    expect(server).toContain('setInterval(()=>void reconcileGithubTerminalUiJobs(),30_000).unref()');
  });

  it('accepts terminal evidence only from this exact GitHub repository',()=>{
    const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    const start=server.indexOf('function localGithubIssueNumberFromRef');
    const end=server.indexOf('function collectResourceScopes',start);
    const parser=server.slice(start,end);
    expect(parser).toContain("u.hostname.toLowerCase()!=='github.com'");
    expect(parser).toContain('selfRunGithubOwner');
    expect(parser).toContain('selfRunGithubRepo');
    expect(parser).toContain("if(!/^\\d+\\/?$/.test(tail))return 0");
  });
});


describe('NV04 explicit dispatch contract plus local-only continuity',()=>{
  it('keeps the explicit NV04 contract while continuity ignores assignment state',()=>{
    const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    expect(server).toContain('function validateNv04AssignmentContract(text:string)');
    expect(server).toContain("['DEEP_RESEARCH','INDEPENDENT_REVIEW'].includes(role)");
    expect(server).toContain("'NV04_CURRENT_WORK_ORDER_REQUIRED'");
    expect(server).toContain("'NV04_EXACT_HEAD_OR_INPUT_REQUIRED'");
    expect(server).toContain("'NV04_RESOURCE_SCOPE_REQUIRED'");
    expect(server).toContain("'NV04_CHECKLIST_REQUIRED'");
    expect(server).toContain("'NV04_OUTPUT_REQUIRED'");
    expect(server).toContain("'NV04_EVIDENCE_DESTINATION_REQUIRED'");
    expect(server).toContain("'NV04_MUTATION_ASSIGNMENT_FORBIDDEN'");

    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const generic=bridge.slice(bridge.indexOf('async function maybeWorkerContinuity'),bridge.indexOf('\nfunction log('));
    const command=bridge.slice(bridge.indexOf('async function handleCommand'),bridge.indexOf('async function postWorkerHeartbeat'));
    expect(bridge).not.toContain('function workerAssignmentStatus(controller,workerId)');
    expect(bridge).not.toContain('currentWorkerAssignmentStatus(');
    expect(bridge).not.toContain('READY_UNASSIGNED');
    expect(generic).toContain('chooseLocalContinuePrompt(w.id,state)');
    expect(generic).not.toContain('assignment.status');
    expect(command).not.toContain('assignment.status');
  });
});

describe('NV02 current-chat continuity lease guard',()=>{
  it('allows conflict-free current-chat or exact claimed self-run continuation',()=>{
    const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    expect(server).toContain("const activeNv02Job=uiJobLedger.active('NV02')");
    expect(server).toContain("const continuityCurrentChatOnly=continuityContinue");
    expect(server).toContain("!autopilotState.pendingJobId");
    expect(server).toContain("!autopilotState.uncertainJobId");
    expect(server).toContain("nv02NextJob?.workerId==='NV02'");
    expect(server).toContain("const continuitySelfRunJob=continuityContinue&&selfRunContinuityClaimMatches(");
    expect(server).toContain("selfRunClaims.find(activeNv02SelfRunIssue,'NV02')");
    expect(server).toContain("const continuityLeaseAllowed=continuitySameJob||continuitySelfRunJob||continuityCurrentChatOnly");
    expect(server).toContain("if(continuityContinue&&!continuityLeaseAllowed)throw new Error('CONTINUITY_SAME_JOB_IDENTITY_REQUIRED:NV02')");
  });
});

describe('Direct-CDP Controller command transport',()=>{
  it('polls, executes and acknowledges Controller commands before continuity automation',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    const heartbeat=bridge.indexOf("await postWorkerHeartbeat(w,target,ui,projectContextReady)");
    const poll=bridge.indexOf("command=await getCommand(w.id)");
    const execute=bridge.indexOf("const result=await handleCommand(w,target,command)");
    const result=bridge.indexOf("await post('/api/result',w.id,{workerId:w.id,commandId:command.id,ok:true");
    const continuity=bridge.indexOf("if(w.id==='NV02')await maybeNv02Continuity(w,target,ui)");
    expect(heartbeat).toBeGreaterThan(-1);
    expect(poll).toBeGreaterThan(heartbeat);
    expect(execute).toBeGreaterThan(poll);
    expect(result).toBeGreaterThan(execute);
    expect(continuity).toBeGreaterThan(result);
    expect(bridge).toContain("CONTROLLER_COMMAND_FAILED");
  });
});

describe('NV02 reboot F5 consolidation #1739',()=>{
  it('rebases stale F5 timers and opens a fresh project context before periodic F5',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(bridge).toContain('let nv02BootF5ScheduleInitialized=false');
    expect(bridge).toContain("'NV02_F5_TIMERS_REBASED_AFTER_RESTART'");
    expect(bridge).toContain('if(persistBootSchedule)saveNv02Continuity(state)');
    expect(bridge).toContain("'DISPATCH_F5_GUARD_ARMED'");
    const dispatchNote=bridge.slice(bridge.indexOf('async function noteNv02CommandDispatch'),bridge.indexOf('async function maybeNv02Continuity'));
    expect(dispatchNote).toContain('state.nextPeriodicF5At=nextRandomAt(now,NV02_F5_MIN_MS,NV02_F5_MAX_MS)');
    expect(dispatchNote).toContain('state.workingRecheckAt=nextRandomAt(now,NV02_F5_MIN_MS,NV02_F5_MAX_MS)');
    expect(bridge).toContain("if(w.id==='NV02')await noteNv02CommandDispatch()");
    const loop=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    const fresh=loop.indexOf("bootFreshContextPending.has('NV02')");
    const f5=loop.indexOf("if(now>=Number(state.nextPeriodicF5At||0))");
    expect(fresh).toBeGreaterThan(-1);
    expect(f5).toBeGreaterThan(-1);
    expect(loop).toContain("if(phase!=='WORKING'&&now>=Number(state.nextRefreshAt||0))");
    expect(loop).not.toContain('state.resumeChatUrl');
    const f5Block=loop.slice(f5,loop.indexOf('const modelCheckRequired='));
    expect(f5Block).toContain('reloadTarget(target)');
  });
});

describe('APP Chrome UI-only continuity regression #1525',()=>{
  it('detects ChatGPT conversation load failure and performs bounded retry -> F5 -> reopen -> backoff',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(bridge).toContain('không thể tải cuộc hội thoại chatgpt này');
    expect(bridge).toContain('chatLoadError');
    expect(bridge).toContain('CHAT_LOAD_RETRY_EXHAUSTED');
    expect(bridge).toContain('CHAT_LOAD_F5_EXHAUSTED');
    expect(bridge).toContain('CHAT_LOAD_REOPEN_REQUESTED');
    expect(bridge).toContain('CHAT_UNLOADABLE_BLOCKED');
    const start=bridge.indexOf('async function maybeRecoverChatLoadError');
    const end=bridge.indexOf('async function reloadTarget',start);
    const recovery=bridge.slice(start,end);
    expect(recovery).toContain('stage===0');
    expect(recovery).toContain('stage===1');
    expect(recovery).toContain('stage===2');
    expect(recovery).toContain('15*60*1000');
    expect(recovery).toContain("CHAT_UNLOADABLE_BLOCKED");
    expect(recovery).toContain('chatLoadStableUi');
    expect(recovery).toContain('CHAT_LOAD_RECOVERY_STABLE_CANDIDATE');
    expect(recovery).toContain('CHAT_LOAD_RECOVERED_STABLE');
    expect(recovery).toContain('now-candidateAt<5000');
    expect(recovery).not.toContain("if(after&&!after.chatLoadError)");
  });

  it('keeps NV02 continuity UI-local while model recovery remains bounded',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(bridge).toContain("return /\\/c\\//.test(current.pathname)");
    expect(bridge).toContain("isWorkerFreshContext");
    expect(bridge).toContain("BOOT_FRESH_CONTEXT_READY");
    expect(bridge).toContain("LOCAL_CONTINUE_DISPATCHED");
    const nv02Loop=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    expect(nv02Loop).not.toContain('currentWorkerAssignmentStatus');
    expect(nv02Loop).not.toContain('READY_UNASSIGNED');
    expect(nv02Loop).not.toContain('autoModelRecoverySuppressed:true');
    expect(nv02Loop).toContain("const modelCheckRequired=");
    expect(nv02Loop).toContain("if(phase==='READY')");
  });
});


describe('NV03/NV04 UI continuity lease regression #1525',()=>{
  it('allows only bounded generic UI maintenance to coexist with a stale active UI ledger record',()=>{
    const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    expect(server).toContain("const genericUiContinuityMaintenance=workerId!=='NV02'");
    for(const purpose of [
      "purpose==='CONTINUITY_CONTINUE'",
      "purpose==='PERIODIC_F5_REFRESH'",
      "purpose==='STALLED_RECOVERY'",
      "purpose==='CHAT_LOAD_RETRY'",
      "purpose==='CHAT_LOAD_F5'",
      "purpose==='DUPLICATE_TAB_PRUNE'",
      "purpose.startsWith('WORKER_REOPEN_CLOSE:')",
    ]) expect(server).toContain(purpose);
    expect(server).toContain('const uiContinuityLeaseAllowed=continuityLeaseAllowed||genericUiContinuityMaintenance');
    expect(server).toContain('||genericUiContinuityMaintenance;');
    expect(server).toContain('&&!uiContinuityLeaseAllowed)throw new Error(`WORKER_ACTIVE_JOB:${workerId}`)');
    expect(server).toContain("if(state.lastHeartbeat?.uiBusy!==false&&!staleWorkingRecovery&&!periodicF5&&!chatLoadRecoveryStateAllowed)throw new Error(`WORKER_UI_BUSY_OR_UNKNOWN:${workerId}`)");
    expect(server).toContain("if(commandQueues.get(workerId)!.length>0||[...waiters.values()].some((w)=>w.workerId===workerId))");
  });
});

describe('NV02 chat-load recovery lease #1567',()=>{
  it('allows only verified timeout/load-error recovery to bypass stale busy telemetry',()=>{
    const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    expect(server).toContain("const chatLoadRetryRecovery=workerId==='NV02'&&purpose==='CHAT_LOAD_RETRY'");
    expect(server).toContain("const chatLoadF5Recovery=workerId==='NV02'&&purpose==='CHAT_LOAD_F5'");
    expect(server).toContain('const chatLoadRecovery=chatLoadRetryRecovery||chatLoadF5Recovery');
    expect(server).toContain("state.lastHeartbeat?.chatLoadError===true");
    expect(server).toContain("!chatLoadRetryRecovery||state.lastHeartbeat?.chatRetryReady===true");
    expect(server).toContain("CHAT_LOAD_RECOVERY_STATE_REQUIRED:");
    expect(server).toContain("!chatLoadRecoveryStateAllowed)throw new Error(`WORKER_UI_BUSY_OR_UNKNOWN:${workerId}`)");
    expect(server).toContain('||chatLoadRecovery||periodicF5');
  });
});

describe('NV04 Gemini assigned-route continuity #1525',()=>{
  it('accepts Gemini routes but never persists a conversation URL as restart authority',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(bridge).toContain("if(current.hostname==='gemini.google.com')");
    expect(bridge).toContain("/^\\/app\\/[A-Za-z0-9_-]+\\/?$/.test(current.pathname)");
    expect(bridge).toContain("state={...state,resumeUrl:'',lastPhase:phase}");
    expect(bridge).not.toContain("resumeUrl:String(ui.url||'')");
  });
});


describe('APP Chrome unified runtime supervisor #1525',()=>{
  it('broker health publishes exact runtime provenance',()=>{
    const broker=readFileSync('apps/chrome-controller/src/chrome-launch-broker.ts','utf8');
    expect(broker).toContain("process.env.TIGERIQ_APPROVED_HEAD");
    expect(broker).toContain("process.env.TIGERIQ_DEPLOY_ROOT");
    expect(broker).toContain("approvedHead:approvedHead||null");
    expect(broker).toContain("deployRoot:deployRoot||null");
  });

  it('keeps the unified task alive, re-reads active deploy, and self-heals only trusted ChromeController listeners',()=>{
    const launcher=readFileSync('apps/chrome-controller/runtime/Start-Unified-AppChrome.ps1','utf8');
    expect(launcher).toContain('while($true)');
    expect(launcher).toContain('Read-ValidatedActive');
    expect(launcher).toContain('Stop-StaleTrustedListener');
    expect(launcher).toContain('PORT_OWNED_BY_UNTRUSTED_PROCESS');
    expect(launcher).toContain("Write-SupervisorEvent 'LIVE_VERIFIED'");
    expect(launcher).toContain("Invoke-RestMethod -Uri 'http://127.0.0.1:8798/api/state'");
    expect(launcher).toContain("Invoke-RestMethod -Uri 'http://127.0.0.1:8799/health'");
    expect(launcher).toContain('Start-Sleep -Seconds $PollSeconds');
    expect(launcher).toContain("Global\\TigerIQ.AppChrome.Unified.Supervisor");
    expect(launcher).toContain('Owner-AutomationAllowed');
    expect(launcher).toContain("OWNER_PAUSE_PRESERVED");
    expect(launcher).toContain('PORT_IDENTITY_PROBE_FAILED');
    expect(launcher).toContain("service -ne 'chrome-launch-broker'");
    expect(launcher).toContain('runtimeProvenance.deployRoot');
    expect(launcher).not.toContain('Get-CimInstance Win32_Process');
    expect(launcher).not.toMatch(/^\\s*\\$pid\\s*=/im);
    expect(launcher).not.toContain('Stop-Process -Name chrome');
  });

  it('activates a new exact-head deploy without requiring a PC reboot',()=>{
    const launcher=readFileSync('apps/chrome-controller/runtime/Start-Unified-AppChrome.ps1','utf8');
    const readActive=launcher.indexOf('$active=Read-ValidatedActive');
    const stopStale=launcher.indexOf('Stop-StaleTrustedListener');
    const verify=launcher.indexOf('Wait-LiveVerified $active');
    expect(readActive).toBeGreaterThan(-1);
    expect(stopStale).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(readActive);
    expect(launcher).toContain('$headChanged=$lastHead-ne$active.head');
    expect(launcher).toContain("Start-Component 8800 $broker @($broker,$ConfigPath) 'broker' $active");
    expect(launcher).toContain('BROKER_PROVENANCE_INVALID');
    expect(launcher).toContain('Get-TrustedListenerIdentity');
  });

  it('artifact install restarts the existing unified task without privilege escalation or requiring a PC reboot',()=>{
    const installer=readFileSync('apps/chrome-controller/runtime/Install-ApprovedArtifact.ps1','utf8');
    expect(installer).toContain("$taskName='TigerIQ APP Chrome Unified'");
    expect(installer).toContain("$taskActivation=if($task){'TASK_PRESENT'}else{'TASK_ABSENT'}");
    expect(installer).toContain("activation='SUPERVISOR_PENDING'");
    expect(installer).toContain("Stop-ScheduledTask -TaskName $taskName");
    expect(installer).toContain("Start-ScheduledTask -TaskName $taskName");
    expect(installer).not.toContain('New-ScheduledTaskPrincipal');
    expect(installer).not.toContain('Set-ScheduledTask -TaskName $taskName');
    expect(installer).not.toContain('RunLevel Highest');
  });
});
