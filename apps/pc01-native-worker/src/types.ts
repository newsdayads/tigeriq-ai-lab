import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const PC01_EMPLOYEE_ID='EMP-PC01-NATIVE';
export const PC01_DEVICE_ID='DEV-PC01';
export const PC01_BINDING_ID='BIND-PC01-NATIVE';
export const PC01_CAPABILITIES=['local_ai','filesystem','git','node','npm','python','build','test','http_api','automation','evidence'] as const;
export const PC01_PERMISSIONS=['workspace:read','workspace:write','git:read','git:branch','node:execute','npm:execute','python:execute','test:execute','http:local','evidence:write','local_ai:execute'] as const;
export const OUTPUT_LIMIT=256_000;

export interface WorkerJob {
  jobId:string; title:string; objective:string; payload:Record<string,unknown>; requiredCapabilities:string[]; requiredPermissions:string[];
  expectedEvidence:('text'|'json'|'log'|'commit'|'url'|'screenshot')[]; independentReview:boolean; judgeRequired:boolean;
}
export interface WorkerLease { leaseId:string; leaseToken:string; expiresAt:string; job:WorkerJob; }
export interface Identity { employeeId:string;deviceId:string;bindingId:string;nodeId:string;publicKeyBase64:string;publicKeyFingerprint:string;privateKeyPem:string; }
export interface ResourceSnapshot { cpuPercent:number|null;totalRamBytes:number;freeRamBytes:number;freeRamPercent:number;hostname:string;platform:string; }
export interface OllamaMetrics { model:string;totalDurationMs?:number;loadDurationMs?:number;promptTokens?:number;evalTokens?:number;tokensPerSec?:number;sizeBytes?:number;vramBytes?:number;processor?:string; }
export interface ToolExecutionResult { operation:string;exitCode:number;stdout:string;stderr:string;durationMs:number;timedOut:boolean;detail?:Record<string,unknown>; }
export interface EvidenceDocument {
  work_order_id:string;worker:string;device:string;started_at:string;completed_at:string;input_task_summary:string;selected_route:string;model?:string;
  commands_tools_executed:unknown[];test_results:unknown[];output_result?:Record<string,unknown>;reviewer_gate_result:Record<string,unknown>;errors_retries:unknown[];final_status:'completed'|'failed';
}
export interface NativeWorkerConfig { workspace:string;identityFile:string;controllerUrl:string;ingressToken:string;ollamaEndpoint:string;ollamaModel:string;pollMs:number;heartbeatMs:number;maxConcurrentJobs:number;minFreeRamBytes:number; }

export function sha256(value:Buffer|string):string{return createHash('sha256').update(value).digest('hex');}
export function sleep(ms:number):Promise<void>{return new Promise(resolve=>setTimeout(resolve,ms));}
export function asRecord(value:unknown):Record<string,unknown>|undefined{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
export function stringValue(value:unknown):string|undefined{return typeof value==='string'&&value.trim()?value.trim():undefined;}
export function numberValue(value:unknown):number|undefined{const n=Number(value);return Number.isFinite(n)?n:undefined;}
export function boolValue(value:unknown,fallback=false):boolean{return typeof value==='boolean'?value:fallback;}
export function truncate(value:string,max=OUTPUT_LIMIT):string{return value.length<=max?value:`${value.slice(0,max)}\n[TIGERIQ_OUTPUT_TRUNCATED ${value.length-max} chars]`;}

export class Semaphore {
  private active=0;private readonly waiters:Array<()=>void>=[];
  constructor(readonly limit:number){if(!Number.isInteger(limit)||limit<1)throw new Error('semaphore limit must be positive');}
  get activeCount():number{return this.active;}
  async use<T>(fn:()=>Promise<T>):Promise<T>{if(this.active>=this.limit)await new Promise<void>(resolve=>this.waiters.push(resolve));this.active++;try{return await fn();}finally{this.active--;this.waiters.shift()?.();}}
}

export class ResourceMonitor {
  private previous?:{idle:number;total:number};
  snapshot():ResourceSnapshot{
    const cpus=os.cpus();let idle=0,total=0;for(const cpu of cpus){idle+=cpu.times.idle;total+=Object.values(cpu.times).reduce((sum,value)=>sum+value,0);}
    let cpuPercent:number|null=null;if(this.previous){const idleDelta=idle-this.previous.idle,totalDelta=total-this.previous.total;if(totalDelta>0)cpuPercent=Math.max(0,Math.min(100,100-idleDelta/totalDelta*100));}this.previous={idle,total};
    const totalRamBytes=os.totalmem(),freeRamBytes=os.freemem();return {cpuPercent,totalRamBytes,freeRamBytes,freeRamPercent:totalRamBytes?freeRamBytes/totalRamBytes*100:0,hostname:os.hostname(),platform:`${os.platform()}-${os.arch()}`};
  }
}

export class CapabilityRouter {
  select(job:WorkerJob):'deterministic'|'tool'|'local_ai'|'cloud'{
    const explicit=stringValue(job.payload.route);if(explicit){if(['deterministic','tool','local_ai','cloud'].includes(explicit))return explicit as 'deterministic'|'tool'|'local_ai'|'cloud';throw new Error(`ROUTE_UNSUPPORTED:${explicit}`);}
    if(asRecord(job.payload.toolRequest)||Array.isArray(job.payload.toolRequests))return 'tool';
    if(job.requiredCapabilities.includes('local_ai')||job.payload.taskType==='ai'||typeof job.payload.prompt==='string')return 'local_ai';return 'deterministic';
  }
}

export class EvidenceStore {
  constructor(readonly workspace:string){}
  async persist(document:EvidenceDocument):Promise<{absolutePath:string;relativePath:string;sha256:string}>{
    const safeJob=document.work_order_id.replace(/[^A-Za-z0-9._-]/g,'_'),directory=path.join(this.workspace,'.tigeriq-runtime','evidence',safeJob);await mkdir(directory,{recursive:true});
    const filename=`${Date.now()}-${document.final_status}.json`,absolutePath=path.join(directory,filename),raw=`${JSON.stringify(document,null,2)}\n`;await writeFile(absolutePath,raw,'utf8');
    return {absolutePath,relativePath:path.relative(this.workspace,absolutePath).replaceAll('\\','/'),sha256:sha256(raw)};
  }
}

export async function loadOrCreateIdentity(identityFile:string):Promise<Identity>{
  try{const parsed=JSON.parse(await readFile(identityFile,'utf8')) as Identity;if(parsed.privateKeyPem&&parsed.publicKeyBase64&&parsed.publicKeyFingerprint)return parsed;}catch{}
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1',publicKeyEncoding:{type:'spki',format:'der'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}),publicKeyBase64=pair.publicKey.toString('base64');
  const identity:Identity={employeeId:PC01_EMPLOYEE_ID,deviceId:PC01_DEVICE_ID,bindingId:PC01_BINDING_ID,nodeId:'PC01',publicKeyBase64,publicKeyFingerprint:sha256(pair.publicKey),privateKeyPem:pair.privateKey};
  await mkdir(path.dirname(identityFile),{recursive:true});const temp=`${identityFile}.tmp`;await writeFile(temp,JSON.stringify(identity,null,2),'utf8');await rename(temp,identityFile);return identity;
}

export function configFromEnv():NativeWorkerConfig{
  const workspace=path.resolve(process.env.TIGERIQ_WORKSPACE?.trim()||process.cwd()),stateRoot=process.env.TIGERIQ_PC01_STATE_DIR?.trim()||path.join(process.env.LOCALAPPDATA||workspace,'TigerIQ','pc01-native-worker'),ingressToken=(process.env.TIGERIQ_INGRESS_TOKEN??'').trim();
  if(ingressToken.length<32)throw new Error('TIGERIQ_INGRESS_TOKEN must contain at least 32 characters');
  return {workspace,identityFile:path.join(stateRoot,'identity.json'),controllerUrl:process.env.TIGERIQ_CONTROLLER_URL?.trim()||'http://100.97.23.87:8790',ingressToken,ollamaEndpoint:process.env.TIGERIQ_OLLAMA_URL?.trim()||'http://127.0.0.1:11434',ollamaModel:process.env.TIGERIQ_OLLAMA_MODEL?.trim()||'qwen3:8b',pollMs:Math.max(250,Number(process.env.TIGERIQ_WORKER_POLL_MS??1000)),heartbeatMs:Math.max(5000,Number(process.env.TIGERIQ_HEARTBEAT_MS??15000)),maxConcurrentJobs:Math.min(8,Math.max(1,Number(process.env.TIGERIQ_WORKER_MAX_JOBS??4))),minFreeRamBytes:Math.max(4,Number(process.env.TIGERIQ_MIN_FREE_RAM_GB??8))*1024**3};
}
