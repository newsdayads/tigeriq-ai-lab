import { execFileSync } from 'node:child_process';
import { existsSync,mkdtempSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ts from 'typescript';
import { describe,expect,it } from 'vitest';
import { DurableDispatchLeaseStore } from '../apps/chrome-controller/src/dispatch-lease.js';
import { decideAutoContinue,freshAutopilotState,type DurableAutopilotState,type ExternalAutopilotSnapshot } from '../apps/chrome-controller/src/autopilot.js';
import { heartbeatStopReason } from '../apps/chrome-controller/src/security-gate.js';

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
