import { existsSync, readFileSync } from 'node:fs';
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

export class DurableSelfRunClaimStore {
  private value:ClaimFile;
  constructor(private readonly path:string){
    this.value=this.load();
    this.pruneExpired(Date.now());
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
  private pruneExpired(nowMs:number){
    const before=this.value.claims.length;
    this.value.claims=this.value.claims.filter((x)=>Date.parse(x.expiresAt)>nowMs);
    if(this.value.claims.length!==before)this.save();
  }
  acquire(input:{issueNumber:number;scope:string;workerId:WorkerId;ttlMs:number;claimId?:string},nowMs=Date.now()):SelfRunClaimAcquire{
    this.pruneExpired(nowMs);
    const busy=this.value.claims.find((x)=>x.issueNumber===input.issueNumber||x.scope===input.scope);
    if(busy)return {kind:'BUSY',claim:{...busy}};
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
  }
  release(claimId:string){
    const before=this.value.claims.length;
    this.value.claims=this.value.claims.filter((x)=>x.claimId!==claimId);
    if(this.value.claims.length!==before)this.save();
    return before!==this.value.claims.length;
  }
  find(issueNumber:number,workerId?:WorkerId){
    this.pruneExpired(Date.now());
    const found=this.value.claims.find((x)=>x.issueNumber===issueNumber&&(!workerId||x.workerId===workerId));
    return found?{...found}:undefined;
  }
  snapshot(){
    this.pruneExpired(Date.now());
    return this.value.claims.map((x)=>({...x}));
  }
}
