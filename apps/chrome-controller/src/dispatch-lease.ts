import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export type DispatchLeaseState='RESERVED'|'DISPATCHING'|'COMMITTED';
export interface DispatchLease {
  schemaVersion:'tigeriq.chrome-controller.dispatch-lease.v2';
  leaseId:string;
  ownerId:string;
  jobId:string;
  state:DispatchLeaseState;
  acquiredAt:string;
  expiresAt:string;
  takeoverOf?:string;
  dispatchedAt?:string;
}
export type LeaseAcquireResult=
  | {kind:'ACQUIRED'|'TAKEN_OVER';lease:DispatchLease}
  | {kind:'BUSY'|'COMMITTED';lease:DispatchLease}
  | {kind:'UNCERTAIN';lease?:DispatchLease;reason:string};
export type PendingReconcileResult=
  | {kind:'WAIT'|'COMMITTED';lease:DispatchLease}
  | {kind:'SAFE_RETRY';lease:DispatchLease}
  | {kind:'UNCERTAIN';lease?:DispatchLease;reason:string};

function code(error:unknown){return error instanceof Error&&'code' in error?String((error as NodeJS.ErrnoException).code??''):'';}
function iso(ms:number){return new Date(ms).toISOString();}
function parse(path:string):DispatchLease|undefined{
  if(!existsSync(path))return;
  try{return JSON.parse(readFileSync(path,'utf8')) as DispatchLease;}catch{return;}
}

export class DurableDispatchLeaseStore{
  readonly #path:string;
  readonly #ownerId:string;
  readonly #ttlMs:number;
  constructor(path:string,ownerId:string,ttlMs:number){
    if(!ownerId.trim())throw new Error('DISPATCH_LEASE_OWNER_REQUIRED');
    if(!Number.isFinite(ttlMs)||ttlMs<60_000)throw new Error('DISPATCH_LEASE_TTL_TOO_SMALL');
    this.#path=path;this.#ownerId=ownerId;this.#ttlMs=ttlMs;
  }
  read():{lease?:DispatchLease;malformed:boolean}{
    const lease=parse(this.#path);
    return{lease,malformed:existsSync(this.#path)&&!lease};
  }
  acquire(jobId:string,nowMs=Date.now()):LeaseAcquireResult{
    if(!jobId.trim())return{kind:'UNCERTAIN',reason:'DISPATCH_LEASE_JOB_REQUIRED'};
    const current=this.read();
    if(current.malformed)return{kind:'UNCERTAIN',reason:'DISPATCH_LEASE_STATE_MALFORMED'};
    if(!current.lease)return this.#create(jobId,nowMs);
    const lease=current.lease;
    if(lease.jobId===jobId&&lease.state==='COMMITTED')return{kind:'COMMITTED',lease};
    if(lease.state==='COMMITTED')return this.#retireAndCreate(lease,jobId,nowMs);
    const expiry=Date.parse(lease.expiresAt);
    if(!Number.isFinite(expiry))return{kind:'UNCERTAIN',lease,reason:'DISPATCH_LEASE_EXPIRY_INVALID'};
    if(expiry>nowMs)return{kind:'BUSY',lease};
    if(lease.state==='DISPATCHING')return{kind:'UNCERTAIN',lease,reason:`DISPATCH_INFLIGHT_STALE:${lease.jobId}`};
    return this.#retireAndCreate(lease,jobId,nowMs);
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
    return this.#transition(leaseId,jobId,'RESERVED','DISPATCHING',{expiresAt:iso(nowMs+this.#ttlMs)});
  }
  markCommitted(leaseId:string,jobId:string,nowMs=Date.now()):DispatchLease{
    return this.#transition(leaseId,jobId,'DISPATCHING','COMMITTED',{dispatchedAt:iso(nowMs),expiresAt:iso(nowMs+this.#ttlMs)});
  }
  #transition(leaseId:string,jobId:string,from:DispatchLeaseState,to:DispatchLeaseState,extra:Partial<DispatchLease>):DispatchLease{
    const current=this.read();const lease=current.lease;
    if(current.malformed||!lease)throw new Error('DISPATCH_LEASE_MISSING_OR_MALFORMED');
    if(lease.leaseId!==leaseId||lease.ownerId!==this.#ownerId||lease.jobId!==jobId)throw new Error('DISPATCH_LEASE_TOKEN_MISMATCH');
    if(lease.state!==from)throw new Error(`DISPATCH_LEASE_STATE_${lease.state}_EXPECTED_${from}`);
    const next={...lease,...extra,state:to};
    this.#atomic(next);return next;
  }
  #atomic(lease:DispatchLease){
    const temp=`${this.#path}.${this.#ownerId}.tmp`;
    writeFileSync(temp,`${JSON.stringify(lease,null,2)}\n`,'utf8');
    renameSync(temp,this.#path);
  }
  #create(jobId:string,nowMs:number,takeoverOf?:string):LeaseAcquireResult{
    const lease:DispatchLease={schemaVersion:'tigeriq.chrome-controller.dispatch-lease.v2',leaseId:randomUUID(),ownerId:this.#ownerId,jobId,state:'RESERVED',acquiredAt:iso(nowMs),expiresAt:iso(nowMs+this.#ttlMs),...(takeoverOf?{takeoverOf}: {})};
    try{writeFileSync(this.#path,`${JSON.stringify(lease,null,2)}\n`,{encoding:'utf8',flag:'wx'});return{kind:takeoverOf?'TAKEN_OVER':'ACQUIRED',lease};}
    catch(error){if(code(error)!=='EEXIST')throw error;const winner=this.read();if(winner.malformed||!winner.lease)return{kind:'UNCERTAIN',reason:'DISPATCH_LEASE_RACE_UNRESOLVED'};return winner.lease.jobId===jobId&&winner.lease.state==='COMMITTED'?{kind:'COMMITTED',lease:winner.lease}:{kind:'BUSY',lease:winner.lease};}
  }

  #retireAndCreate(stale:DispatchLease,jobId:string,nowMs:number):LeaseAcquireResult{
    const retired=`${this.#path}.retired.${stale.leaseId}.${nowMs}`;
    try{renameSync(this.#path,retired);}catch(error){
      if(code(error)==='ENOENT')return this.#create(jobId,nowMs);
      return{kind:'UNCERTAIN',lease:stale,reason:`DISPATCH_LEASE_TAKEOVER_FAILED:${code(error)||'UNKNOWN'}`};
    }
    return this.#create(jobId,nowMs,stale.leaseId);
  }
}
