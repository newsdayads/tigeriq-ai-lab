import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe,expect,it } from 'vitest';
import { DurableDispatchLeaseStore } from '../apps/chrome-controller/src/dispatch-lease.js';
import { decideAutoContinue,freshAutopilotState,type ExternalAutopilotSnapshot } from '../apps/chrome-controller/src/autopilot.js';

const observedAt='2026-09-17T00:00:10.000Z';
const completedAt='2026-09-17T00:00:05.000Z';
const verifiedAt='2026-09-17T00:00:09.000Z';
const now=Date.parse(observedAt);
function snapshot(riskFlags:string[]=[]):ExternalAutopilotSnapshot{return{
  source:'GITHUB',observedAt,revision:'github-ui-v2:test',
  previousJob:{jobId:'GH-1',workerId:'NV02',status:'DONE',executable:true,priority:'P0',completedAt,completionRevision:'rev-gh-1',evidence:[{source:'GITHUB',ref:'https://github.com/x/1',verifiedAt,jobId:'GH-1',completedAt,completionRevision:'rev-gh-1'}]},
  nextJob:{jobId:'GH-2',workerId:'NV02',status:'READY',executable:true,priority:'P0',prompt:'safe',riskFlags},requiredWorkers:[],
};}

describe('durable dispatch lease',()=>{
  it('suppresses a committed job across a different controller instance',()=>{
    const dir=mkdtempSync(join(tmpdir(),'tigeriq-lease-'));const path=join(dir,'lease.json');
    const a=new DurableDispatchLeaseStore(path,'controller-a',60_000);const b=new DurableDispatchLeaseStore(path,'controller-b',60_000);
    const acquired=a.acquire('GH-1',1000);expect(acquired.kind).toBe('ACQUIRED');if(acquired.kind!=='ACQUIRED')return;
    a.markDispatching(acquired.lease.leaseId,'GH-1',2000);a.markCommitted(acquired.lease.leaseId,'GH-1',3000);
    expect(b.acquire('GH-1',4000)).toMatchObject({kind:'COMMITTED',lease:{jobId:'GH-1',state:'COMMITTED'}});
    expect(b.acquire('GH-2',4000).kind).toBe('TAKEN_OVER');
  });  it('reconciles a reserved pending dispatch before allowing bounded takeover',()=>{
    const dir=mkdtempSync(join(tmpdir(),'tigeriq-lease-'));const path=join(dir,'lease.json');
    const a=new DurableDispatchLeaseStore(path,'controller-a',60_000);const b=new DurableDispatchLeaseStore(path,'controller-b',60_000);
    expect(a.acquire('GH-1',1000).kind).toBe('ACQUIRED');
    expect(b.reconcilePending('GH-1',30_000).kind).toBe('WAIT');
    expect(b.reconcilePending('GH-1',62_000).kind).toBe('SAFE_RETRY');
    expect(b.acquire('GH-2',62_000).kind).toBe('TAKEN_OVER');
  });
  it('fails closed instead of taking over an expired in-flight dispatch',()=>{
    const dir=mkdtempSync(join(tmpdir(),'tigeriq-lease-'));const path=join(dir,'lease.json');
    const a=new DurableDispatchLeaseStore(path,'controller-a',60_000);const b=new DurableDispatchLeaseStore(path,'controller-b',60_000);
    const acquired=a.acquire('GH-1',1000);if(acquired.kind!=='ACQUIRED')throw new Error('setup');a.markDispatching(acquired.lease.leaseId,'GH-1',2000);
    expect(b.reconcilePending('GH-1',63_000)).toMatchObject({kind:'UNCERTAIN',reason:'DISPATCH_INFLIGHT_STALE:GH-1'});
    expect(b.acquire('GH-2',63_000)).toMatchObject({kind:'UNCERTAIN',reason:'DISPATCH_INFLIGHT_STALE:GH-1'});
  });
});

describe('fresh completion evidence and security fail-closed matrix',()=>{
  it('accepts only evidence correlated to the exact completed job and after dispatch',()=>{
    const state={...freshAutopilotState(),lastDispatchedJobId:'GH-1',lastDispatchedAt:'2026-09-17T00:00:01.000Z'};
    expect(decideAutoContinue(snapshot(),state,now)).toMatchObject({kind:'DISPATCH',jobId:'GH-2'});
    const wrong=snapshot();wrong.previousJob!.evidence![0].jobId='GH-X';expect(decideAutoContinue(wrong,state,now)).toMatchObject({kind:'WAIT_EVIDENCE'});
    const old=snapshot();old.previousJob!.completedAt='2026-09-17T00:00:00.000Z';old.previousJob!.evidence![0].completedAt='2026-09-17T00:00:00.000Z';expect(decideAutoContinue(old,state,now)).toMatchObject({kind:'WAIT_EVIDENCE'});
  });  it('stops on AUTH/REAUTH/CAPTCHA/RATE_LIMIT and related security flags',()=>{
    for(const flag of ['AUTH_REQUIRED','REAUTH','CAPTCHA','RATE_LIMIT','RATE_LIMIT_429','HTTP_429','SECURITY_WARNING','SUSPICIOUS_ACTIVITY']){
      expect(decideAutoContinue(snapshot([flag]),freshAutopilotState(),now)).toMatchObject({kind:'STOP',reason:`RISK_FLAG_${flag}`});
    }
  });
});
