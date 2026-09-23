import { existsSync, readFileSync, mkdirSync, rmdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { WorkerId } from './model.js';
import { atomicWriteJsonWithRetry } from './runtime-evidence.js';

export interface SelfRunClaimRecord {
  claimId:string;
  issueNumber:number;
  scope:string;
  workerId:WorkerId;
  createdAt:string;
  expiresAt:string;
}
interface ClaimFile {
  schemaVersion:'tigeriq.appchrome.self-run-claims.v1';
  claims:SelfRunClaimRecord[];
}
export type SelfRunClaimAcquire =
  | {kind:'ACQUIRED';claim:SelfRunClaimRecord}
  | {kind:'BUSY';claim:SelfRunClaimRecord};

function waitSync(ms:number){
  const view=new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view,0,0,ms);
}

export class DurableSelfRunClaimStore {
  private value:ClaimFile;
  private readonly lockPath:string;
  constructor(private readonly path:string){
    this.lockPath=`${path}.lock`;
    this.value=this.load();
    this.withLock(()=>{this.pruneExpiredNoLock(Date.now());this.save();});
  }
  private load():ClaimFile{
    if(!existsSync(this.path))return {schemaVersion:'tigeriq.appchrome.self-run-claims.v1',claims:[]};
    try{
      const raw=JSON.parse(readFileSync(this.path,'utf8')) as Partial<ClaimFile>;
      const claims=Array.isArray(raw.claims)?raw.claims.filter((x):x is SelfRunClaimRecord=>Boolean(
        x&&typeof x.claimId==='string'&&Number.isFinite(Number(x.issueNumber))&&typeof x.scope==='string'&&
        ['NV02','NV03','NV04'].includes(String(x.workerId))&&typeof x.createdAt==='string'&&typeof x.expiresAt==='string'
      )):[];
      return {schemaVersion:'tigeriq.appchrome.self-run-claims.v1',claims};
    }catch{
      return {schemaVersion:'tigeriq.appchrome.self-run-claims.v1',claims:[]};
    }
  }
  private save(){atomicWriteJsonWithRetry(this.path,this.value);}
  private acquireFileLock(){
    for(let attempt=0;attempt<6;attempt+=1){
      try{
        mkdirSync(this.lockPath);
        return;
      }catch(error){
        const code=error instanceof Error&&'code' in error?String((error as NodeJS.ErrnoException).code??''):'';
        if(code!=='EEXIST')throw error;
        try{
          const ageMs=Date.now()-statSync(this.lockPath).mtimeMs;
          if(ageMs>30_000){rmdirSync(this.lockPath);continue;}
        }catch{}
        waitSync(10*(attempt+1));
      }
    }
    throw new Error('SELF_RUN_CLAIM_STORE_LOCK_BUSY');
  }
  private withLock<T>(fn:()=>T):T{
    this.acquireFileLock();
    try{
      this.value=this.load();
      return fn();
    }finally{
      try{rmdirSync(this.lockPath);}catch{}
    }
  }
  private pruneExpiredNoLock(nowMs:number){
    this.value.claims=this.value.claims.filter((x)=>Date.parse(x.expiresAt)>nowMs);
  }
  acquire(input:{issueNumber:number;scope:string;workerId:WorkerId;ttlMs:number;claimId?:string},nowMs=Date.now()):SelfRunClaimAcquire{
    return this.withLock(()=>{
      this.pruneExpiredNoLock(nowMs);
      const busy=this.value.claims.find((x)=>x.issueNumber===input.issueNumber||x.scope===input.scope);
      if(busy){this.save();return {kind:'BUSY',claim:{...busy}};}
      const claim:SelfRunClaimRecord={
        claimId:input.claimId||randomUUID(),
        issueNumber:input.issueNumber,
        scope:input.scope,
        workerId:input.workerId,
        createdAt:new Date(nowMs).toISOString(),
        expiresAt:new Date(nowMs+input.ttlMs).toISOString(),
      };
      this.value.claims.push(claim);
      this.save();
      return {kind:'ACQUIRED',claim:{...claim}};
    });
  }
  release(claimId:string){
    return this.withLock(()=>{
      this.pruneExpiredNoLock(Date.now());
      const before=this.value.claims.length;
      this.value.claims=this.value.claims.filter((x)=>x.claimId!==claimId);
      this.save();
      return before!==this.value.claims.length;
    });
  }
  find(issueNumber:number,workerId?:WorkerId){
    return this.withLock(()=>{
      this.pruneExpiredNoLock(Date.now());
      const found=this.value.claims.find((x)=>x.issueNumber===issueNumber&&(!workerId||x.workerId===workerId));
      this.save();
      return found?{...found}:undefined;
    });
  }
  snapshot(){
    return this.withLock(()=>{
      this.pruneExpiredNoLock(Date.now());
      this.save();
      return this.value.claims.map((x)=>({...x}));
    });
  }
}
