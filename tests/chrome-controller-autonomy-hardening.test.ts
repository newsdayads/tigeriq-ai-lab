import { execFileSync } from 'node:child_process';
import { existsSync,mkdtempSync,readFileSync,readdirSync,renameSync,unlinkSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ts from 'typescript';
import { describe,expect,it } from 'vitest';
import { DurableDispatchLeaseStore } from '../apps/chrome-controller/src/dispatch-lease.js';
import { canResetOrphanUnpersistedDispatch,classifyAutoContinueDispatchFailure,decideAutoContinue,freshAutopilotState,type DurableAutopilotState,type ExternalAutopilotSnapshot } from '../apps/chrome-controller/src/autopilot.js';
import { heartbeatStopReason } from '../apps/chrome-controller/src/security-gate.js';
import { atomicWriteJsonWithRetry, type AtomicJsonFileOps } from '../apps/chrome-controller/src/runtime-evidence.js';

const observedAt='2026-09-17T00:00:10.000Z';
const completedAt='2026-09-17T00:00:05.000Z';
const verifiedAt='2026-09-17T00:00:09.000Z';
const now=Date.parse(observedAt);
const dispatchedState=():DurableAutopilotState=>({...freshAutopilotState(),lastDispatchedJobId:'GH-1',lastDispatchedAt:'2026-09-17T00:00:01.000Z'});
function snapshot(riskFlags:string[]=[]):ExternalAutopilotSnapshot{return{
  source:'GITHUB',observedAt,revision:'github-ui-v2:test',
  previousJob:{jobId:'GH-1',workerId:'NV02',status:'DONE',executable:true,priority:'P0',completedAt,completionRevision:'closure-1',evidence:[{source:'GITHUB',ref:'https://github.com/x/1',verifiedAt,jobId:'GH-1',completedAt,completionRevision:'closure-1'}]},
  nextJob:{jobId:'GH-2',workerId:'NV02',status:'READY',executable:true,priority:'P0',prompt:'safe',riskFlags},requiredWorkers:[],
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
});

describe('fresh completion evidence',()=>{
  it('requires durable proof of the exact prior dispatch and completion after it',()=>{
    expect(decideAutoContinue(snapshot(),dispatchedState(),now)).toMatchObject({kind:'DISPATCH',jobId:'GH-2'});
    expect(decideAutoContinue(snapshot(),freshAutopilotState(),now)).toMatchObject({kind:'WAIT_EVIDENCE'});
    expect(decideAutoContinue(snapshot(),{...freshAutopilotState(),lastDispatchedJobId:'GH-1'},now)).toMatchObject({kind:'WAIT_EVIDENCE'});
    const wrong=snapshot();wrong.previousJob!.evidence![0].jobId='GH-X';expect(decideAutoContinue(wrong,dispatchedState(),now)).toMatchObject({kind:'WAIT_EVIDENCE'});
    const old=snapshot();old.previousJob!.completedAt='2026-09-17T00:00:00.000Z';old.previousJob!.evidence![0].completedAt='2026-09-17T00:00:00.000Z';expect(decideAutoContinue(old,dispatchedState(),now)).toMatchObject({kind:'WAIT_EVIDENCE'});
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
    expect(server).toContain("await dispatch('NV02',decision.text,false,'AUTO_CONTINUE',{jobId:decision.jobId");
    expect(server).not.toContain("await dispatch('NV02',decision.text,true,'AUTO_CONTINUE')");
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
