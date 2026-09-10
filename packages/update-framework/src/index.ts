export type UpdatePhase='check'|'stage'|'verify'|'apply'|'health'|'commit'|'rollback'|'noop'|'failed'|'busy';
export type UpdateStatus='updated'|'no_change'|'rolled_back'|'failed'|'busy';

export interface ComponentUpdateManifest {
  schemaVersion:1;
  component:string;
  version:string;
  revision:number;
  sourceSha:string;
  artifactSha256:string;
  preserveKeys:string[];
  maxAttempts?:number;
}

export interface InstalledComponentState {
  version:string;
  revision:number;
  artifactSha256?:string;
}

export interface StagedCandidate<THandle=unknown> {
  sha256:string;
  handle:THandle;
}

export interface UpdateCheck { ok:boolean; detail?:string }
export interface UpdateEvidenceEvent { phase:UpdatePhase; ok:boolean; at:string; detail?:string }

export interface ZeroTouchComponentAdapter<THandle=unknown> {
  current():Promise<InstalledComponentState>;
  stage(manifest:ComponentUpdateManifest):Promise<StagedCandidate<THandle>>;
  verify(manifest:ComponentUpdateManifest,candidate:StagedCandidate<THandle>):Promise<UpdateCheck>;
  capturePreserved(keys:string[]):Promise<Record<string,string>>;
  apply(manifest:ComponentUpdateManifest,candidate:StagedCandidate<THandle>):Promise<void>;
  health(manifest:ComponentUpdateManifest):Promise<UpdateCheck>;
  commit(manifest:ComponentUpdateManifest,candidate:StagedCandidate<THandle>):Promise<void>;
  rollback(previous:InstalledComponentState,candidate:StagedCandidate<THandle>):Promise<void>;
}

export interface UpdateResult {
  component:string;
  targetVersion:string;
  previousVersion:string;
  status:UpdateStatus;
  attempts:number;
  rolledBack:boolean;
  evidence:UpdateEvidenceEvent[];
  error?:string;
}

function assertManifest(manifest:ComponentUpdateManifest):void{
  if(manifest.schemaVersion!==1)throw new Error('MANIFEST_SCHEMA_UNSUPPORTED');
  if(!/^[A-Za-z0-9._-]{2,80}$/.test(manifest.component))throw new Error('MANIFEST_COMPONENT_INVALID');
  if(!manifest.version.trim()||manifest.version.length>80)throw new Error('MANIFEST_VERSION_INVALID');
  if(!Number.isInteger(manifest.revision)||manifest.revision<1)throw new Error('MANIFEST_REVISION_INVALID');
  if(!/^[0-9a-f]{40}$/i.test(manifest.sourceSha))throw new Error('MANIFEST_SOURCE_SHA_INVALID');
  if(!/^[0-9a-f]{64}$/i.test(manifest.artifactSha256))throw new Error('MANIFEST_ARTIFACT_SHA256_INVALID');
  if(!Array.isArray(manifest.preserveKeys)||new Set(manifest.preserveKeys).size!==manifest.preserveKeys.length)throw new Error('MANIFEST_PRESERVE_KEYS_INVALID');
  if(manifest.preserveKeys.some(k=>!k||k.length>120))throw new Error('MANIFEST_PRESERVE_KEYS_INVALID');
  if(manifest.maxAttempts!==undefined&&(!Number.isInteger(manifest.maxAttempts)||manifest.maxAttempts<1||manifest.maxAttempts>3))throw new Error('MANIFEST_MAX_ATTEMPTS_INVALID');
}

function samePreserved(before:Record<string,string>,after:Record<string,string>,keys:string[]):boolean{
  return keys.every(key=>Object.prototype.hasOwnProperty.call(before,key)&&Object.prototype.hasOwnProperty.call(after,key)&&before[key]===after[key]);
}

export class ZeroTouchUpdateCoordinator {
  readonly #inFlight=new Set<string>();
  readonly #now:()=>Date;
  constructor(now:()=>Date=()=>new Date()){this.#now=now;}

  async run<THandle>(manifest:ComponentUpdateManifest,adapter:ZeroTouchComponentAdapter<THandle>):Promise<UpdateResult>{
    assertManifest(manifest);
    const events:UpdateEvidenceEvent[]=[];
    const emit=(phase:UpdatePhase,ok:boolean,detail?:string)=>events.push({phase,ok,at:this.#now().toISOString(),...(detail?{detail}:{})});
    if(this.#inFlight.has(manifest.component)){
      emit('busy',false,'component update already in flight');
      return {component:manifest.component,targetVersion:manifest.version,previousVersion:'unknown',status:'busy',attempts:0,rolledBack:false,evidence:events,error:'UPDATE_IN_FLIGHT'};
    }
    this.#inFlight.add(manifest.component);
    let previous:InstalledComponentState={version:'unknown',revision:0};
    let attempts=0;
    let rolledBack=false;
    try{
      previous=await adapter.current();
      emit('check',true,`current=${previous.version}@${previous.revision}`);
      if(manifest.revision<previous.revision)throw new Error('NON_FORWARD_UPDATE_DENIED');
      if(manifest.revision===previous.revision){
        if(manifest.version!==previous.version)throw new Error('REVISION_COLLISION');
        if(previous.artifactSha256&&previous.artifactSha256.toLowerCase()!==manifest.artifactSha256.toLowerCase())throw new Error('ARTIFACT_COLLISION');
        emit('noop',true,'target already installed');
        return {component:manifest.component,targetVersion:manifest.version,previousVersion:previous.version,status:'no_change',attempts:0,rolledBack:false,evidence:events};
      }
      const preserved=await adapter.capturePreserved(manifest.preserveKeys);
      const maxAttempts=manifest.maxAttempts??1;
      for(attempts=1;attempts<=maxAttempts;attempts++){
        let candidate:StagedCandidate<THandle>|undefined;
        try{
          candidate=await adapter.stage(manifest);emit('stage',true,`attempt=${attempts}`);
          if(candidate.sha256.toLowerCase()!==manifest.artifactSha256.toLowerCase())throw new Error('ARTIFACT_HASH_MISMATCH');
          const verified=await adapter.verify(manifest,candidate);emit('verify',verified.ok,verified.detail);if(!verified.ok)throw new Error('CANDIDATE_VERIFY_FAILED');
          await adapter.apply(manifest,candidate);emit('apply',true,`attempt=${attempts}`);
          const health=await adapter.health(manifest);emit('health',health.ok,health.detail);if(!health.ok)throw new Error('CANDIDATE_HEALTH_FAILED');
          const after=await adapter.capturePreserved(manifest.preserveKeys);
          if(!samePreserved(preserved,after,manifest.preserveKeys))throw new Error('PRESERVED_STATE_MISMATCH');
          await adapter.commit(manifest,candidate);emit('commit',true,`version=${manifest.version}`);
          return {component:manifest.component,targetVersion:manifest.version,previousVersion:previous.version,status:'updated',attempts,rolledBack,evidence:events};
        }catch(error){
          if(candidate){await adapter.rollback(previous,candidate);rolledBack=true;emit('rollback',true,`attempt=${attempts}`);}
          if(attempts>=maxAttempts)throw error;
        }
      }
      throw new Error('UPDATE_ATTEMPTS_EXHAUSTED');
    }catch(error){
      const message=error instanceof Error?error.message:String(error);emit('failed',false,message);
      return {component:manifest.component,targetVersion:manifest.version,previousVersion:previous.version,status:rolledBack?'rolled_back':'failed',attempts,rolledBack,evidence:events,error:message};
    }finally{this.#inFlight.delete(manifest.component);}
  }
}
