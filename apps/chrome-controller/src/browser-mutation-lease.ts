import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export interface BrowserMutationLease {
  schemaVersion:'tigeriq.chrome-controller.browser-mutation-lease.v1';
  workerId:string;
  leaseId:string;
  ownerId:string;
  acquiredAt:string;
  expiresAt:string;
}
type LeaseFile={
  schemaVersion:'tigeriq.chrome-controller.browser-mutation-leases.v1';
  leases:Record<string,BrowserMutationLease>;
};
export type BrowserLeaseAcquireResult=
  | {kind:'ACQUIRED';lease:BrowserMutationLease}
  | {kind:'BUSY';lease:BrowserMutationLease};

function iso(ms:number){return new Date(ms).toISOString();}

export class BrowserMutationLeaseStore{
  readonly #path:string;
  constructor(path:string){this.#path=path;}

  snapshot(nowMs=Date.now()):Record<string,BrowserMutationLease>{
    const state=this.#read();
    const active:Record<string,BrowserMutationLease>={};
    for(const [workerId,lease] of Object.entries(state.leases)){
      if(this.#active(lease,nowMs))active[workerId]=lease;
    }
    return active;
  }

  active(workerId:string,nowMs=Date.now()):BrowserMutationLease|undefined{
    const lease=this.#read().leases[workerId];
    return lease&&this.#active(lease,nowMs)?lease:undefined;
  }

  acquire(workerId:string,ownerId:string,ttlMs=30_000,nowMs=Date.now()):BrowserLeaseAcquireResult{
    if(!workerId.trim())throw new Error('BROWSER_MUTATION_WORKER_REQUIRED');
    if(!ownerId.trim())throw new Error('BROWSER_MUTATION_OWNER_REQUIRED');
    if(!Number.isFinite(ttlMs)||ttlMs<5_000||ttlMs>120_000)throw new Error('BROWSER_MUTATION_TTL_INVALID');
    const state=this.#read();
    const current=state.leases[workerId];
    if(current&&this.#active(current,nowMs))return{kind:'BUSY',lease:current};
    const lease:BrowserMutationLease={
      schemaVersion:'tigeriq.chrome-controller.browser-mutation-lease.v1',
      workerId,
      leaseId:randomUUID(),
      ownerId,
      acquiredAt:iso(nowMs),
      expiresAt:iso(nowMs+ttlMs),
    };
    state.leases[workerId]=lease;
    this.#write(state);
    return{kind:'ACQUIRED',lease};
  }

  release(workerId:string,ownerId:string,leaseId:string):boolean{
    const state=this.#read();
    const current=state.leases[workerId];
    if(!current)return false;
    if(current.ownerId!==ownerId||current.leaseId!==leaseId)throw new Error('BROWSER_MUTATION_LEASE_TOKEN_MISMATCH');
    delete state.leases[workerId];
    this.#write(state);
    return true;
  }

  assertControllerAllowed(workerId:string,nowMs=Date.now()){
    const lease=this.active(workerId,nowMs);
    if(lease)throw new Error(`BROWSER_MUTATION_LEASE_BUSY:${workerId}:${lease.ownerId}`);
  }

  #active(lease:BrowserMutationLease,nowMs:number){
    const expiry=Date.parse(lease.expiresAt);
    if(!Number.isFinite(expiry))throw new Error('BROWSER_MUTATION_LEASE_EXPIRY_INVALID');
    return expiry>nowMs;
  }

  #read():LeaseFile{
    if(!existsSync(this.#path))return{schemaVersion:'tigeriq.chrome-controller.browser-mutation-leases.v1',leases:{}};
    try{
      const value=JSON.parse(readFileSync(this.#path,'utf8')) as LeaseFile;
      if(value?.schemaVersion!=='tigeriq.chrome-controller.browser-mutation-leases.v1'||!value.leases||typeof value.leases!=='object')
        throw new Error('BROWSER_MUTATION_LEASE_STATE_MALFORMED');
      return value;
    }catch(error){
      if(error instanceof Error&&error.message==='BROWSER_MUTATION_LEASE_STATE_MALFORMED')throw error;
      throw new Error('BROWSER_MUTATION_LEASE_STATE_MALFORMED');
    }
  }

  #write(value:LeaseFile){
    const temp=`${this.#path}.${randomUUID()}.tmp`;
    writeFileSync(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');
    renameSync(temp,this.#path);
  }
}
