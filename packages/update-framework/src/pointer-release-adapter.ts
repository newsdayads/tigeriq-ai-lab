import {mkdir,readFile,rename,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {ComponentUpdateManifest,InstalledComponentState,StagedCandidate,UpdateCheck,ZeroTouchComponentAdapter} from './index.js';

export interface PointerReleaseHandle { releaseDir:string; previousPointer:string }
export interface PointerReleaseCandidate { releaseDir:string; sha256:string }

export interface PointerReleaseAdapterOptions {
  releaseRoot:string;
  pointerPath:string;
  statePath:string;
  resolveCandidate:(manifest:ComponentUpdateManifest)=>Promise<PointerReleaseCandidate>;
  verifyCandidate?:(releaseDir:string,manifest:ComponentUpdateManifest)=>Promise<UpdateCheck>;
  activate:(releaseDir:string)=>Promise<void>;
  healthCheck:(releaseDir:string)=>Promise<UpdateCheck>;
  preservedFingerprints:Record<string,()=>Promise<string>>;
}

type PersistedState=InstalledComponentState&{releaseDir:string;sourceSha?:string};

async function atomicWrite(filePath:string,content:string):Promise<void>{
  await mkdir(path.dirname(filePath),{recursive:true});
  const temp=`${filePath}.tigeriq-${process.pid}-${Date.now()}.tmp`;
  await writeFile(temp,content,'utf8');
  await rename(temp,filePath);
}

export class PointerReleaseAdapter implements ZeroTouchComponentAdapter<PointerReleaseHandle>{
  readonly #root:string;
  constructor(readonly options:PointerReleaseAdapterOptions){this.#root=path.resolve(options.releaseRoot);}

  #safeRelease(input:string):string{
    const resolved=path.resolve(input);
    const prefix=this.#root.endsWith(path.sep)?this.#root:`${this.#root}${path.sep}`;
    if(resolved===this.#root||!resolved.startsWith(prefix))throw new Error('RELEASE_PATH_OUTSIDE_ROOT');
    return resolved;
  }

  async #pointer():Promise<string>{
    const value=(await readFile(this.options.pointerPath,'utf8')).trim();
    if(!value)throw new Error('CURRENT_POINTER_EMPTY');
    return this.#safeRelease(value);
  }

  async current():Promise<InstalledComponentState>{
    const raw=JSON.parse(await readFile(this.options.statePath,'utf8')) as Partial<PersistedState>;
    if(typeof raw.version!=='string'||!Number.isInteger(raw.revision)||!raw.releaseDir)throw new Error('UPDATE_STATE_INVALID');
    const releaseDir=this.#safeRelease(raw.releaseDir);
    const pointer=await this.#pointer();
    if(pointer!==releaseDir)throw new Error('UPDATE_STATE_POINTER_MISMATCH');
    return {version:raw.version,revision:raw.revision as number,...(raw.artifactSha256?{artifactSha256:raw.artifactSha256}:{})};
  }

  async stage(manifest:ComponentUpdateManifest):Promise<StagedCandidate<PointerReleaseHandle>>{
    const candidate=await this.options.resolveCandidate(manifest);
    const releaseDir=this.#safeRelease(candidate.releaseDir);
    if(!(await stat(releaseDir)).isDirectory())throw new Error('CANDIDATE_RELEASE_NOT_DIRECTORY');
    return {sha256:candidate.sha256,handle:{releaseDir,previousPointer:await this.#pointer()}};
  }

  async verify(manifest:ComponentUpdateManifest,candidate:StagedCandidate<PointerReleaseHandle>):Promise<UpdateCheck>{
    if(!this.options.verifyCandidate)return {ok:true,detail:'pointer-release candidate verified by manifest hash'};
    return this.options.verifyCandidate(candidate.handle.releaseDir,manifest);
  }

  async capturePreserved(keys:string[]):Promise<Record<string,string>>{
    const values:Record<string,string>={};
    for(const key of keys){
      const reader=this.options.preservedFingerprints[key];
      if(!reader)throw new Error(`PRESERVE_FINGERPRINT_UNAVAILABLE:${key}`);
      values[key]=await reader();
    }
    return values;
  }

  async apply(_manifest:ComponentUpdateManifest,candidate:StagedCandidate<PointerReleaseHandle>):Promise<void>{
    await atomicWrite(this.options.pointerPath,candidate.handle.releaseDir);
    await this.options.activate(candidate.handle.releaseDir);
  }

  async health(_manifest:ComponentUpdateManifest):Promise<UpdateCheck>{
    return this.options.healthCheck(await this.#pointer());
  }

  async commit(manifest:ComponentUpdateManifest,candidate:StagedCandidate<PointerReleaseHandle>):Promise<void>{
    const state:PersistedState={version:manifest.version,revision:manifest.revision,artifactSha256:manifest.artifactSha256,sourceSha:manifest.sourceSha,releaseDir:candidate.handle.releaseDir};
    await atomicWrite(this.options.statePath,JSON.stringify(state,null,2));
  }

  async rollback(_previous:InstalledComponentState,candidate:StagedCandidate<PointerReleaseHandle>):Promise<void>{
    const previous=this.#safeRelease(candidate.handle.previousPointer);
    await atomicWrite(this.options.pointerPath,previous);
    await this.options.activate(previous);
    const check=await this.options.healthCheck(previous);
    if(!check.ok)throw new Error('ROLLBACK_HEALTH_FAILED');
  }
}
