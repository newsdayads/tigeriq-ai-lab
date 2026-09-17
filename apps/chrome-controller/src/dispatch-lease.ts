import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

export type DispatchLeaseState='RESERVED'|'DISPATCHING'|'COMMITTED';
export interface DispatchLease {
  schemaVersion:'tigeriq.chrome-controller.dispatch-lease.v3';
  leaseId:string;
  leaseEpoch:number;
  ownerId:string;
  jobId:string;
  state:DispatchLeaseState;
  acquiredAt:string;
  heartbeatAt:string;
  expiresAt:string;
  takeoverOf?:string;
  dispatchedAt?:string;
}
export type LeaseAcquireResult=
  | {kind:'ACQUIRED'|'TAKEN_OVER';lease:DispatchLease}
  | {kind:'BUSY'|'COMMITTED';lease:DispatchLease}
  | {kind:'UNCERTAIN';lease?:DispatchLease;reason:string};
export type PendingReconcileResult=
  | {kind:'WAIT'|'COMMITTED'|'SAFE_RETRY';lease:DispatchLease}
  | {kind:'UNCERTAIN';lease?:DispatchLease;reason:string};

type TakeoverLock={schemaVersion:'tigeriq.chrome-controller.takeover-lock.v1';lockId:string;ownerId:string;acquiredAt:string;expiresAt:string};
type LockResult={kind:'ACQUIRED';lock:TakeoverLock}|{kind:'BUSY'|'UNCERTAIN';reason:string};

function code(error:unknown){return error instanceof Error&&'code' in error?String((error as NodeJS.ErrnoException).code??''):'';}
function iso(ms:number){return new Date(ms).toISOString();}
function parseJson<T>(path:string):T|undefined{if(!existsSync(path))return;try{return JSON.parse(readFileSync(path,'utf8')) as T;}catch{return;}}

export class DurableDispatchLeaseStore{
  readonly #path:string;
  readonly #lockPath:string;
  readonly #ownerId:string;
  readonly #ttlMs:number;
  readonly #lockTtlMs:number;

  constructor(path:string,ownerId:string,ttlMs:number){
    if(!ownerId.trim())throw new Error('DISPATCH_LEASE_OWNER_REQUIRED');
    if(!Number.isFinite(ttlMs)||ttlMs<60_000)throw new Error('DISPATCH_LEASE_TTL_TOO_SMALL');
    this.#path=path;
    this.#lockPath=`${path}.takeover.lock`;
    this.#ownerId=ownerId;
    this.#ttlMs=ttlMs;
    this.#lockTtlMs=Math.max(10_000,Math.min(60_000,Math.floor(ttlMs/5)));
  }

  read():{lease?:DispatchLease;malformed:boolean}{
    const lease=parseJson<DispatchLease>(this.#path);
    return{lease,malformed:existsSync(this.#path)&&!lease};
  }

  acquire(jobId:string,nowMs=Date.now()):LeaseAcquireResult{
    if(!jobId.trim())return{kind:'UNCERTAIN',reason:'DISPATCH_LEASE_JOB_REQUIRED'};
    const current=this.read();
    if(current.malformed)return{kind:'UNCERTAIN',reason:'DISPATCH_LEASE_STATE_MALFORMED'};
    if(!current.lease)return this.#createExclusive(jobId,nowMs,1);
    return this.#evaluateForAcquire(current.lease,jobId,nowMs);
  }

  reconcilePending(jobId:string,nowMs=Date.now()):PendingReconcileResult{
    const current=this.read();const lease=current.lease;
    if(current.malformed)return{kind:'UNCERTAIN',reason:'DISPATCH_LEASE_STATE_MALFORMED'};
    if(!lease)return{kind:'UNCERTAIN',reason:'DISPATCH_PENDING_WITHOUT_LEASE'};
    if(lease.jobId!==jobId)return{kind:'UNCERTAIN',lease,reason:'DISPATCH_PENDING_LEASE_JOB_MISMATCH'};
    if(lease.state==='COMMITTED')return{kind:'COMMITTED',lease};
    if(lease.state==='DISPATCHING')return{kind:'UNCERTAIN',lease,reason:`DISPATCH_INFLIGHT_STALE:${jobId}`};
    const expiry=Date.parse(lease.expiresAt);
    if(!Number.isFinite(expiry))return{kind:'UNCERTAIN',lease,reason:'DISPATCH_LEASE_EXPIRY_INVALID'};
    return expiry>nowMs?{kind:'WAIT',lease}:{kind:'SAFE_RETRY',lease};
  }

  markDispatching(leaseId:string,jobId:string,nowMs=Date.now()):DispatchLease{
    return this.#transition(leaseId,jobId,'RESERVED','DISPATCHING',nowMs,{expiresAt:iso(nowMs+this.#ttlMs)});
  }

  markRetryable(leaseId:string,jobId:string,nowMs=Date.now()):DispatchLease{
    return this.#transition(leaseId,jobId,'DISPATCHING','RESERVED',nowMs,{expiresAt:iso(nowMs)});
  }

  markCommitted(leaseId:string,jobId:string,nowMs=Date.now()):DispatchLease{
    return this.#transition(leaseId,jobId,'DISPATCHING','COMMITTED',nowMs,{dispatchedAt:iso(nowMs),expiresAt:iso(nowMs+this.#ttlMs)});
  }

  #evaluateForAcquire(lease:DispatchLease,jobId:string,nowMs:number):LeaseAcquireResult{
    if(lease.jobId===jobId&&lease.state==='COMMITTED')return{kind:'COMMITTED',lease};
    if(lease.state==='COMMITTED')return this.#takeover(lease,jobId,nowMs);
    const expiry=Date.parse(lease.expiresAt);
    if(!Number.isFinite(expiry))return{kind:'UNCERTAIN',lease,reason:'DISPATCH_LEASE_EXPIRY_INVALID'};
    if(expiry>nowMs)return{kind:'BUSY',lease};
    if(lease.state==='DISPATCHING')return{kind:'UNCERTAIN',lease,reason:`DISPATCH_INFLIGHT_STALE:${lease.jobId}`};
    return this.#takeover(lease,jobId,nowMs);
  }

  #transition(leaseId:string,jobId:string,from:DispatchLeaseState,to:DispatchLeaseState,nowMs:number,extra:Partial<DispatchLease>):DispatchLease{
    const current=this.read();const lease=current.lease;
    if(current.malformed||!lease)throw new Error('DISPATCH_LEASE_MISSING_OR_MALFORMED');
    if(lease.leaseId!==leaseId||lease.ownerId!==this.#ownerId||lease.jobId!==jobId)throw new Error('DISPATCH_LEASE_TOKEN_MISMATCH');
    if(lease.state!==from)throw new Error(`DISPATCH_LEASE_STATE_${lease.state}_EXPECTED_${from}`);
    const next={...lease,...extra,state:to,heartbeatAt:iso(nowMs)};
    this.#atomicReplace(next);
    return next;
  }

  #takeover(stale:DispatchLease,jobId:string,nowMs:number):LeaseAcquireResult{
    const lockResult=this.#acquireTakeoverLock(nowMs);
    if(lockResult.kind!=='ACQUIRED')return{kind:lockResult.kind==='BUSY'?'BUSY':'UNCERTAIN',lease:stale,reason:lockResult.reason} as LeaseAcquireResult;
    try{
      const current=this.read();const lease=current.lease;
      if(current.malformed||!lease)return{kind:'UNCERTAIN',reason:'DISPATCH_LEASE_STATE_CHANGED_OR_MALFORMED'};
      if(lease.leaseId!==stale.leaseId)return this.#evaluateRaceWinner(lease,jobId,nowMs);
      if(lease.state==='DISPATCHING')return{kind:'UNCERTAIN',lease,reason:`DISPATCH_INFLIGHT_STALE:${lease.jobId}`};
      if(lease.state==='RESERVED'){
        const expiry=Date.parse(lease.expiresAt);
        if(!Number.isFinite(expiry))return{kind:'UNCERTAIN',lease,reason:'DISPATCH_LEASE_EXPIRY_INVALID'};
        if(expiry>nowMs)return{kind:'BUSY',lease};
      }
      const next=this.#newLease(jobId,nowMs,lease.leaseEpoch+1,lease.leaseId);
      this.#atomicReplace(next);
      return{kind:'TAKEN_OVER',lease:next};
    }finally{this.#releaseTakeoverLock(lockResult.lock);}
  }

  #evaluateRaceWinner(lease:DispatchLease,jobId:string,nowMs:number):LeaseAcquireResult{
    if(lease.jobId===jobId&&lease.state==='COMMITTED')return{kind:'COMMITTED',lease};
    const expiry=Date.parse(lease.expiresAt);
    if(lease.state==='DISPATCHING'&&Number.isFinite(expiry)&&expiry<=nowMs)return{kind:'UNCERTAIN',lease,reason:`DISPATCH_INFLIGHT_STALE:${lease.jobId}`};
    return{kind:'BUSY',lease};
  }

  #acquireTakeoverLock(nowMs:number):LockResult{
    const attempt=():LockResult=>{
      const lock:TakeoverLock={schemaVersion:'tigeriq.chrome-controller.takeover-lock.v1',lockId:randomUUID(),ownerId:this.#ownerId,acquiredAt:iso(nowMs),expiresAt:iso(nowMs+this.#lockTtlMs)};
      try{
        writeFileSync(this.#lockPath,`${JSON.stringify(lock,null,2)}\n`,{encoding:'utf8',flag:'wx'});
        return{kind:'ACQUIRED',lock};
      }catch(error){
        if(code(error)!=='EEXIST')return{kind:'UNCERTAIN',reason:`DISPATCH_TAKEOVER_LOCK_CREATE_FAILED:${code(error)||'UNKNOWN'}`};
        return{kind:'BUSY',reason:'DISPATCH_TAKEOVER_LOCK_BUSY'};
      }
    };
    const first=attempt();
    if(first.kind==='ACQUIRED')return first;
    if(first.kind==='UNCERTAIN')return first;
    const existing=parseJson<TakeoverLock>(this.#lockPath);
    if(!existing)return{kind:'UNCERTAIN',reason:'DISPATCH_TAKEOVER_LOCK_MALFORMED'};
    const expiry=Date.parse(existing.expiresAt);
    if(!Number.isFinite(expiry))return{kind:'UNCERTAIN',reason:'DISPATCH_TAKEOVER_LOCK_EXPIRY_INVALID'};
    if(expiry>nowMs)return first;
    const retired=`${this.#lockPath}.stale.${existing.lockId}.${nowMs}`;
    try{renameSync(this.#lockPath,retired);}catch(error){
      const c=code(error);
      if(c!=='ENOENT')return{kind:'UNCERTAIN',reason:`DISPATCH_TAKEOVER_LOCK_RECOVERY_FAILED:${c||'UNKNOWN'}`};
    }
    return attempt();
  }

  #releaseTakeoverLock(lock:TakeoverLock){
    const current=parseJson<TakeoverLock>(this.#lockPath);
    if(current?.lockId!==lock.lockId)return;
    try{unlinkSync(this.#lockPath);}catch(error){if(code(error)!=='ENOENT')throw error;}
  }

  #createExclusive(jobId:string,nowMs:number,epoch:number):LeaseAcquireResult{
    const lease=this.#newLease(jobId,nowMs,epoch);
    try{
      writeFileSync(this.#path,`${JSON.stringify(lease,null,2)}\n`,{encoding:'utf8',flag:'wx'});
      return{kind:'ACQUIRED',lease};
    }catch(error){
      if(code(error)!=='EEXIST')throw error;
      const winner=this.read();
      if(winner.malformed||!winner.lease)return{kind:'UNCERTAIN',reason:'DISPATCH_LEASE_RACE_UNRESOLVED'};
      return this.#evaluateRaceWinner(winner.lease,jobId,nowMs);
    }
  }

  #newLease(jobId:string,nowMs:number,epoch:number,takeoverOf?:string):DispatchLease{
    return{schemaVersion:'tigeriq.chrome-controller.dispatch-lease.v3',leaseId:randomUUID(),leaseEpoch:epoch,ownerId:this.#ownerId,jobId,state:'RESERVED',acquiredAt:iso(nowMs),heartbeatAt:iso(nowMs),expiresAt:iso(nowMs+this.#ttlMs),...(takeoverOf?{takeoverOf}: {})};
  }

  #atomicReplace(lease:DispatchLease){
    const temp=`${this.#path}.${this.#ownerId}.${randomUUID()}.tmp`;
    writeFileSync(temp,`${JSON.stringify(lease,null,2)}\n`,'utf8');
    renameSync(temp,this.#path);
  }
}
