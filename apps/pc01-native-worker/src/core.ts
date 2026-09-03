import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign as signPayload } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const PC01_EMPLOYEE_ID='EMP-PC01-NATIVE';
export const PC01_DEVICE_ID='DEV-PC01';
export const PC01_BINDING_ID='BIND-PC01-NATIVE';
export const PC01_CAPABILITIES=['local_ai','filesystem','git','node','npm','python','build','test','http_api','automation','evidence'] as const;
export const PC01_PERMISSIONS=['workspace:read','workspace:write','git:read','git:branch','node:execute','npm:execute','python:execute','test:execute','http:local','evidence:write','local_ai:execute'] as const;
const OUTPUT_LIMIT=256_000;
const SECRET_PATH_PATTERN=/(^|[\\/])(\.env(?:\.|$)|credentials?(?:\.|$)|secrets?(?:\.|$)|id_rsa|id_ed25519|\.npmrc$)/i;

export interface WorkerJob {
  jobId:string; title:string; objective:string; payload:Record<string,unknown>; requiredCapabilities:string[]; requiredPermissions:string[];
  expectedEvidence:('text'|'json'|'log'|'commit'|'url'|'screenshot')[]; independentReview:boolean; judgeRequired:boolean;
}
export interface WorkerLease { leaseId:string; leaseToken:string; expiresAt:string; job:WorkerJob; }
export interface Identity { employeeId:string;deviceId:string;bindingId:string;nodeId:string;publicKeyBase64:string;publicKeyFingerprint:string;privateKeyPem:string; }
export interface ResourceSnapshot { cpuPercent:number|null; totalRamBytes:number; freeRamBytes:number; freeRamPercent:number; hostname:string; platform:string; }
export interface OllamaMetrics { model:string; totalDurationMs?:number; loadDurationMs?:number; promptTokens?:number; evalTokens?:number; tokensPerSec?:number; sizeBytes?:number; vramBytes?:number; processor?:string; }
export interface ToolExecutionResult { operation:string; exitCode:number; stdout:string; stderr:string; durationMs:number; timedOut:boolean; detail?:Record<string,unknown>; }
export interface EvidenceDocument {
  work_order_id:string;worker:string;device:string;started_at:string;completed_at:string;input_task_summary:string;selected_route:string;model?:string;
  commands_tools_executed:unknown[];test_results:unknown[];output_result?:Record<string,unknown>;reviewer_gate_result:Record<string,unknown>;errors_retries:unknown[];final_status:'completed'|'failed';
}

function sha256Bytes(value:Buffer|string):string{return createHash('sha256').update(value).digest('hex');}
function sleep(ms:number):Promise<void>{return new Promise(resolve=>setTimeout(resolve,ms));}
function asRecord(value:unknown):Record<string,unknown>|undefined{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
function stringValue(value:unknown):string|undefined{return typeof value==='string'&&value.trim()?value.trim():undefined;}
function numberValue(value:unknown):number|undefined{const n=Number(value);return Number.isFinite(n)?n:undefined;}
function boolValue(value:unknown,fallback=false):boolean{return typeof value==='boolean'?value:fallback;}
function truncate(value:string,max=OUTPUT_LIMIT):string{return value.length<=max?value:`${value.slice(0,max)}\n[TIGERIQ_OUTPUT_TRUNCATED ${value.length-max} chars]`;}

export class Semaphore {
  private active=0;
  private readonly waiters:Array<()=>void>=[];
  constructor(readonly limit:number){if(!Number.isInteger(limit)||limit<1)throw new Error('semaphore limit must be positive');}
  get activeCount():number{return this.active;}
  async use<T>(fn:()=>Promise<T>):Promise<T>{
    if(this.active>=this.limit)await new Promise<void>(resolve=>this.waiters.push(resolve));
    this.active++;
    try{return await fn();}finally{this.active--;this.waiters.shift()?.();}
  }
}

export class ResourceMonitor {
  private previous?:{idle:number;total:number};
  snapshot():ResourceSnapshot{
    const cpus=os.cpus();let idle=0,total=0;
    for(const cpu of cpus){idle+=cpu.times.idle;total+=Object.values(cpu.times).reduce((a,b)=>a+b,0);}
    let cpuPercent:number|null=null;
    if(this.previous){const idleDelta=idle-this.previous.idle,totalDelta=total-this.previous.total;if(totalDelta>0)cpuPercent=Math.max(0,Math.min(100,100-(idleDelta/totalDelta*100)));}
    this.previous={idle,total};
    const totalRamBytes=os.totalmem(),freeRamBytes=os.freemem();
    return {cpuPercent,totalRamBytes,freeRamBytes,freeRamPercent:totalRamBytes?freeRamBytes/totalRamBytes*100:0,hostname:os.hostname(),platform:`${os.platform()}-${os.arch()}`};
  }
}

export class OllamaProvider {
  readonly semaphore:Semaphore;
  constructor(readonly endpoint='http://127.0.0.1:11434',readonly model='qwen3:8b',readonly numCtx=4096,maxConcurrency=2,readonly timeoutMs=120_000){this.semaphore=new Semaphore(maxConcurrency);}
  async health():Promise<Record<string,unknown>>{
    const response=await this.fetchWithTimeout('/api/tags',{method:'GET'},10_000);
    if(!response.ok)throw new Error(`OLLAMA_HEALTH_${response.status}`);
    const body=await response.json() as Record<string,unknown>;
    return {ok:true,model:this.model,models:Array.isArray(body.models)?body.models.length:undefined};
  }
  async generate(prompt:string,options?:{temperature?:number;json?:boolean;keepAlive?:string}):Promise<{content:string;parsed?:Record<string,unknown>;metrics:OllamaMetrics}>{
    return this.semaphore.use(async()=>{
      const body:Record<string,unknown>={model:this.model,prompt,stream:false,think:false,keep_alive:options?.keepAlive??'15m',options:{num_ctx:this.numCtx,temperature:options?.temperature??0.1}};
      if(options?.json)body.format='json';
      const response=await this.fetchWithTimeout('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},this.timeoutMs);
      if(!response.ok)throw new Error(`OLLAMA_HTTP_${response.status}`);
      const result=await response.json() as Record<string,unknown>;
      const content=stringValue(result.response)??'';
      let parsed:Record<string,unknown>|undefined;
      if(options?.json){try{parsed=asRecord(JSON.parse(content));}catch{throw new Error('OLLAMA_INVALID_JSON_RESPONSE');}}
      const metrics:OllamaMetrics={model:this.model};
      const totalDuration=numberValue(result.total_duration),loadDuration=numberValue(result.load_duration),evalDuration=numberValue(result.eval_duration),promptTokens=numberValue(result.prompt_eval_count),evalTokens=numberValue(result.eval_count);
      if(totalDuration!==undefined)metrics.totalDurationMs=totalDuration/1e6;
      if(loadDuration!==undefined)metrics.loadDurationMs=loadDuration/1e6;
      if(promptTokens!==undefined)metrics.promptTokens=promptTokens;
      if(evalTokens!==undefined)metrics.evalTokens=evalTokens;
      if(evalTokens!==undefined&&evalDuration&&evalDuration>0)metrics.tokensPerSec=evalTokens/(evalDuration/1e9);
      try{Object.assign(metrics,await this.processorInfo());}catch{}
      return {content,parsed,metrics};
    });
  }
  private async processorInfo():Promise<Partial<OllamaMetrics>>{
    const response=await this.fetchWithTimeout('/api/ps',{method:'GET'},5_000);if(!response.ok)return {};
    const body=await response.json() as {models?:Array<Record<string,unknown>>};
    const model=body.models?.find(item=>stringValue(item.name)===this.model||stringValue(item.model)===this.model)??body.models?.[0];if(!model)return {};
    const size=numberValue(model.size),vram=numberValue(model.size_vram);let processor:string|undefined;
    if(size&&vram!==undefined)processor=vram>=size*0.95?'100% GPU':vram<=size*0.05?'100% CPU':`${Math.round(vram/size*100)}% GPU`;
    return {sizeBytes:size,vramBytes:vram,processor};
  }
  private fetchWithTimeout(resource:string,init:RequestInit,timeoutMs:number):Promise<Response>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    return fetch(new URL(resource,this.endpoint),{...init,signal:controller.signal}).finally(()=>clearTimeout(timer));
  }
}

export type ToolRequest =
  | {operation:'read_file';path:string;maxBytes?:number}
  | {operation:'write_file';path:string;content:string}
  | {operation:'git';action:'status'|'diff'|'branch'|'checkout';branch?:string}
  | {operation:'npm';script:'build'|'test'|'typecheck'|'lint'|'ci'}
  | {operation:'node';script:string;args?:string[]}
  | {operation:'python';script:string;args?:string[]}
  | {operation:'http';method:'GET'|'POST';url:string;body?:Record<string,unknown>};

export class ToolPolicyError extends Error { constructor(readonly code:string,message:string){super(message);} }
export class ToolExecutor {
  private readonly root:string;
  constructor(workspace:string,readonly defaultTimeoutMs=120_000){this.root=path.resolve(workspace);}
  async execute(raw:unknown):Promise<ToolExecutionResult>{
    const request=this.validate(raw),started=Date.now();
    switch(request.operation){
      case 'read_file':{
        const target=this.safePath(request.path,false),max=Math.min(Math.max(request.maxBytes??1_000_000,1),5_000_000),info=await stat(target);
        if(!info.isFile()||info.size>max)throw new ToolPolicyError('FILE_READ_LIMIT','file is not a permitted bounded file');
        const content=await readFile(target,'utf8');return {operation:'read_file',exitCode:0,stdout:truncate(content),stderr:'',durationMs:Date.now()-started,timedOut:false,detail:{path:path.relative(this.root,target),bytes:info.size}};
      }
      case 'write_file':{
        const target=this.safePath(request.path,true);await mkdir(path.dirname(target),{recursive:true});const temp=`${target}.tigeriq-${process.pid}.tmp`;await writeFile(temp,request.content,'utf8');await rename(temp,target);
        return {operation:'write_file',exitCode:0,stdout:`WROTE ${Buffer.byteLength(request.content)} bytes`,stderr:'',durationMs:Date.now()-started,timedOut:false,detail:{path:path.relative(this.root,target)}};
      }
      case 'git':{
        if(request.action==='checkout'){
          const branch=request.branch??'';if(!/^[A-Za-z0-9._/-]{1,160}$/.test(branch)||['main','master','production','prod'].includes(branch.toLowerCase()))throw new ToolPolicyError('GIT_BRANCH_DENIED','checkout target is not an allowed feature branch');
          return this.spawnSafe('git',['checkout',branch],this.defaultTimeoutMs);
        }
        const args=request.action==='status'?['status','--short','--branch']:request.action==='diff'?['diff','--']:['branch','--show-current'];return this.spawnSafe('git',args,this.defaultTimeoutMs);
      }
      case 'npm':{
        const npm=process.platform==='win32'?'npm.cmd':'npm';
        const args=request.script==='test'?['test','--','--runInBand']:['run',request.script];
        return this.spawnSafe(npm,args,Math.max(this.defaultTimeoutMs,300_000));
      }
      case 'node':return this.spawnSafe(process.execPath,[this.safeScript(request.script,['.js','.mjs','.cjs']),...this.safeArgs(request.args)],this.defaultTimeoutMs);
      case 'python':return this.spawnSafe(process.env.TIGERIQ_PYTHON_BIN?.trim()||'python',[this.safeScript(request.script,['.py']),...this.safeArgs(request.args)],this.defaultTimeoutMs);
      case 'http':return this.localHttp(request,started);
    }
  }
  private validate(raw:unknown):ToolRequest{
    const row=asRecord(raw);if(!row)throw new ToolPolicyError('TOOL_REQUEST_INVALID','tool request must be an object');
    const operation=stringValue(row.operation);if(!operation||!['read_file','write_file','git','npm','node','python','http'].includes(operation))throw new ToolPolicyError('TOOL_OPERATION_DENIED','operation is not allowlisted');
    if(operation==='read_file'){return {operation,path:this.requiredText(row.path,'path'),maxBytes:numberValue(row.maxBytes)};}
    if(operation==='write_file'){return {operation,path:this.requiredText(row.path,'path'),content:typeof row.content==='string'?row.content:(()=>{throw new ToolPolicyError('TOOL_REQUEST_INVALID','content must be string');})()};}
    if(operation==='git'){const action=this.requiredText(row.action,'action') as ToolRequest&any;if(!['status','diff','branch','checkout'].includes(action))throw new ToolPolicyError('GIT_ACTION_DENIED','git action denied');return {operation,action,branch:stringValue(row.branch)} as ToolRequest;}
    if(operation==='npm'){const script=this.requiredText(row.script,'script');if(!['build','test','typecheck','lint','ci'].includes(script))throw new ToolPolicyError('NPM_SCRIPT_DENIED','npm script denied');return {operation,script} as ToolRequest;}
    if(operation==='node'||operation==='python')return {operation,script:this.requiredText(row.script,'script'),args:Array.isArray(row.args)?row.args.map(v=>this.requiredText(v,'arg')):undefined} as ToolRequest;
    const method=(stringValue(row.method)??'GET').toUpperCase();if(method!=='GET'&&method!=='POST')throw new ToolPolicyError('HTTP_METHOD_DENIED','HTTP method denied');return {operation:'http',method,url:this.requiredText(row.url,'url'),body:asRecord(row.body)};
  }
  private requiredText(value:unknown,name:string):string{const text=stringValue(value);if(!text||text.length>4096)throw new ToolPolicyError('TOOL_REQUEST_INVALID',`${name} is required`);return text;}
  private safePath(relative:string,writing:boolean):string{
    if(path.isAbsolute(relative))throw new ToolPolicyError('PATH_DENIED','absolute paths are denied');
    const target=path.resolve(this.root,relative),prefix=this.root.endsWith(path.sep)?this.root:`${this.root}${path.sep}`;
    if(target!==this.root&&!target.startsWith(prefix))throw new ToolPolicyError('PATH_DENIED','path escapes workspace');
    if(SECRET_PATH_PATTERN.test(target))throw new ToolPolicyError('SECRET_PATH_DENIED','credential-like paths are denied');
    if(writing&&target.includes(`${path.sep}.git${path.sep}`))throw new ToolPolicyError('GIT_INTERNAL_WRITE_DENIED','direct .git writes are denied');
    return target;
  }
  private safeScript(relative:string,extensions:string[]):string{const target=this.safePath(relative,false);if(!extensions.includes(path.extname(target).toLowerCase()))throw new ToolPolicyError('SCRIPT_TYPE_DENIED','script extension denied');return target;}
  private safeArgs(values?:string[]):string[]{if(!values)return [];if(values.length>32||values.some(v=>v.length>2048||v.includes('\u0000')))throw new ToolPolicyError('ARGUMENTS_DENIED','arguments exceed policy');return values;}
  private spawnSafe(command:string,args:string[],timeoutMs:number):Promise<ToolExecutionResult>{
    const started=Date.now();return new Promise((resolve,reject)=>{
      const child=spawn(command,args,{cwd:this.root,shell:false,windowsHide:true,env:{...process.env}});let stdout='',stderr='',timedOut=false,settled=false;
      const append=(current:string,chunk:Buffer|string)=>truncate(current+chunk.toString(),OUTPUT_LIMIT);
      child.stdout?.on('data',chunk=>{stdout=append(stdout,chunk);});child.stderr?.on('data',chunk=>{stderr=append(stderr,chunk);});
      const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeoutMs);
      child.once('error',error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);});
      child.once('close',code=>{if(settled)return;settled=true;clearTimeout(timer);resolve({operation:[command,...args].join(' '),exitCode:timedOut?124:(code??1),stdout,stderr,durationMs:Date.now()-started,timedOut});});
    });
  }
  private async localHttp(request:Extract<ToolRequest,{operation:'http'}>,started:number):Promise<ToolExecutionResult>{
    const url=new URL(request.url);if(url.protocol!=='http:')throw new ToolPolicyError('HTTP_SCHEME_DENIED','only local HTTP is allowed');
    if(!['127.0.0.1','localhost','100.97.23.87'].includes(url.hostname))throw new ToolPolicyError('HTTP_HOST_DENIED','HTTP host is outside PC01 local boundary');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.defaultTimeoutMs);
    try{const response=await fetch(url,{method:request.method,headers:request.body?{'Content-Type':'application/json'}:undefined,body:request.body?JSON.stringify(request.body):undefined,signal:controller.signal});const text=truncate(await response.text());return {operation:`http ${request.method} ${url.origin}${url.pathname}`,exitCode:response.ok?0:1,stdout:text,stderr:response.ok?'':`HTTP ${response.status}`,durationMs:Date.now()-started,timedOut:false,detail:{status:response.status}};}catch(error){if((error as Error).name==='AbortError')return {operation:`http ${request.method}`,exitCode:124,stdout:'',stderr:'timeout',durationMs:Date.now()-started,timedOut:true};throw error;}finally{clearTimeout(timer);}
  }
}

export class CapabilityRouter {
  select(job:WorkerJob):'deterministic'|'tool'|'local_ai'|'cloud'{
    const explicit=stringValue(job.payload.route);
    if(explicit){if(['deterministic','tool','local_ai','cloud'].includes(explicit))return explicit as ReturnType<CapabilityRouter['select']>;throw new Error(`ROUTE_UNSUPPORTED:${explicit}`);}
    if(asRecord(job.payload.toolRequest))return 'tool';
    if(job.requiredCapabilities.includes('local_ai')||job.payload.taskType==='ai'||typeof job.payload.prompt==='string')return 'local_ai';
    return 'deterministic';
  }
}

export class EvidenceStore {
  constructor(readonly workspace:string){}
  async persist(document:EvidenceDocument):Promise<{absolutePath:string;relativePath:string;sha256:string}>{
    const safeJob=document.work_order_id.replace(/[^A-Za-z0-9._-]/g,'_'),directory=path.join(this.workspace,'.tigeriq-runtime','evidence',safeJob);await mkdir(directory,{recursive:true});
    const filename=`${Date.now()}-${document.final_status}.json`,absolutePath=path.join(directory,filename),raw=`${JSON.stringify(document,null,2)}\n`;await writeFile(absolutePath,raw,'utf8');
    return {absolutePath,relativePath:path.relative(this.workspace,absolutePath).replaceAll('\\','/'),sha256:sha256Bytes(raw)};
  }
}

export async function loadOrCreateIdentity(identityFile:string):Promise<Identity>{
  try{const parsed=JSON.parse(await readFile(identityFile,'utf8')) as Identity;if(parsed.privateKeyPem&&parsed.publicKeyBase64&&parsed.publicKeyFingerprint)return parsed;}catch{}
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1',publicKeyEncoding:{type:'spki',format:'der'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  const publicKeyBase64=pair.publicKey.toString('base64'),identity:Identity={employeeId:PC01_EMPLOYEE_ID,deviceId:PC01_DEVICE_ID,bindingId:PC01_BINDING_ID,nodeId:'PC01',publicKeyBase64,publicKeyFingerprint:sha256Bytes(pair.publicKey),privateKeyPem:pair.privateKey};
  await mkdir(path.dirname(identityFile),{recursive:true});const temp=`${identityFile}.tmp`;await writeFile(temp,JSON.stringify(identity,null,2),'utf8');await rename(temp,identityFile);return identity;
}

export class ControllerClient {
  constructor(readonly baseUrl:string,readonly ingressToken:string,readonly identity:Identity){}
  async register(metadata:Record<string,unknown>):Promise<Record<string,unknown>>{
    return this.request('/api/v1/pc01/register',{employeeId:this.identity.employeeId,deviceId:this.identity.deviceId,bindingId:this.identity.bindingId,nodeId:this.identity.nodeId,displayName:'PC01 Native Worker',platform:'windows-pc01',publicKeyBase64:this.identity.publicKeyBase64,publicKeyFingerprint:this.identity.publicKeyFingerprint,capabilities:[...PC01_CAPABILITIES],permissions:[...PC01_PERMISSIONS],concurrencyLimit:4,metadata},{Authorization:`Bearer ${this.ingressToken}`});
  }
  async heartbeat(snapshot:Record<string,unknown>,health:'ok'|'degraded'='ok'):Promise<void>{await this.signed(`/api/v1/devices/${encodeURIComponent(this.identity.deviceId)}/heartbeat`,{health,metadata:snapshot});}
  async lease():Promise<WorkerLease|undefined>{const body=await this.signed('/api/v1/jobs/lease',{leaseTtlMs:120_000});return (body.lease??undefined) as WorkerLease|undefined;}
  async renew(lease:WorkerLease):Promise<void>{await this.signed(`/api/v1/jobs/${encodeURIComponent(lease.job.jobId)}/lease/renew`,{leaseId:lease.leaseId,leaseToken:lease.leaseToken,leaseTtlMs:120_000});}
  async submit(lease:WorkerLease,result:Record<string,unknown>):Promise<Record<string,unknown>>{return this.signed(`/api/v1/jobs/${encodeURIComponent(lease.job.jobId)}/result`,{leaseId:lease.leaseId,leaseToken:lease.leaseToken,result});}
  private async signed(resource:string,body:Record<string,unknown>):Promise<Record<string,unknown>>{
    const raw=Buffer.from(JSON.stringify(body),'utf8'),timestamp=String(Date.now()),nonce=randomBytes(16).toString('hex'),bodyHash=sha256Bytes(raw),canonical=`POST\n${resource}\n${this.identity.employeeId}\n${this.identity.nodeId}\n${this.identity.deviceId}\n${timestamp}\n${nonce}\n${bodyHash}`,challenge=sha256Bytes(canonical),signature=signPayload('sha256',Buffer.from(canonical,'utf8'),createPrivateKey(this.identity.privateKeyPem)).toString('base64url');
    return this.requestRaw(resource,raw,{'X-TigerIQ-Device-Proof-V':'1','X-TigerIQ-Employee-Id':this.identity.employeeId,'X-TigerIQ-Node-Id':this.identity.nodeId,'X-TigerIQ-Device-Id':this.identity.deviceId,'X-TigerIQ-Device-Key-Fingerprint':this.identity.publicKeyFingerprint,'X-TigerIQ-Device-Public-Key':this.identity.publicKeyBase64,'X-TigerIQ-Device-Timestamp':timestamp,'X-TigerIQ-Device-Nonce':nonce,'X-TigerIQ-Device-Challenge':challenge,'X-TigerIQ-Device-Signature':signature});
  }
  private request(resource:string,body:Record<string,unknown>,headers:Record<string,string>):Promise<Record<string,unknown>>{return this.requestRaw(resource,Buffer.from(JSON.stringify(body),'utf8'),headers);}
  private async requestRaw(resource:string,raw:Buffer,headers:Record<string,string>):Promise<Record<string,unknown>>{
    const response=await fetch(new URL(resource,this.baseUrl),{method:'POST',headers:{'Content-Type':'application/json',...headers},body:raw});const parsed=await response.json() as Record<string,unknown>;
    if(!response.ok){const error=asRecord(parsed.error);throw new Error(`${stringValue(error?.code)??`HTTP_${response.status}`}:${stringValue(error?.message)??'controller request failed'}`);}return parsed;
  }
}

export interface NativeWorkerConfig { workspace:string;identityFile:string;controllerUrl:string;ingressToken:string;ollamaEndpoint:string;ollamaModel:string;pollMs:number;heartbeatMs:number;maxConcurrentJobs:number;minFreeRamBytes:number; }
export class NativeWorker {
  readonly resources=new ResourceMonitor();readonly router=new CapabilityRouter();readonly executor:ToolExecutor;readonly evidence:EvidenceStore;readonly ollama:OllamaProvider;
  private readonly inflight=new Map<string,Promise<void>>();private stopped=false;private client?:ControllerClient;
  constructor(readonly config:NativeWorkerConfig){this.executor=new ToolExecutor(config.workspace);this.evidence=new EvidenceStore(config.workspace);this.ollama=new OllamaProvider(config.ollamaEndpoint,config.ollamaModel,4096,2);}
  async start():Promise<void>{
    const identity=await loadOrCreateIdentity(this.config.identityFile);this.client=new ControllerClient(this.config.controllerUrl,this.config.ingressToken,identity);
    const ollamaHealth=await this.ollama.health();await this.client.register({hostname:os.hostname(),workspace:this.config.workspace,ollama:ollamaHealth,workerVersion:'pc01-native-worker-v1'});
    await this.sendHeartbeat();const heartbeat=setInterval(()=>void this.sendHeartbeat().catch(error=>console.error(JSON.stringify({event:'PC01_HEARTBEAT_ERROR',message:String(error)}))),this.config.heartbeatMs);
    try{while(!this.stopped){await this.fillCapacity();await sleep(this.config.pollMs);}}finally{clearInterval(heartbeat);await Promise.allSettled(this.inflight.values());}
  }
  stop():void{this.stopped=true;}
  private async fillCapacity():Promise<void>{
    if(!this.client)return;const snapshot=this.resources.snapshot();if(snapshot.freeRamBytes<this.config.minFreeRamBytes)return;
    while(this.inflight.size<this.config.maxConcurrentJobs&&!this.stopped){let lease:WorkerLease|undefined;try{lease=await this.client.lease();}catch(error){console.error(JSON.stringify({event:'PC01_LEASE_ERROR',message:String(error)}));return;}if(!lease)return;if(this.inflight.has(lease.job.jobId))continue;
      const work=this.executeLease(lease).finally(()=>this.inflight.delete(lease!.job.jobId));this.inflight.set(lease.job.jobId,work);
    }
  }
  private async executeLease(lease:WorkerLease):Promise<void>{
    if(!this.client)return;const startedAt=new Date().toISOString(),route=this.router.select(lease.job),commands:unknown[]=[],tests:unknown[]=[],errors:unknown[]=[];let model:string|undefined,output:Record<string,unknown>|undefined,renewFailed=false;
    const renewer=setInterval(()=>void this.client!.renew(lease).catch(error=>{renewFailed=true;errors.push({phase:'lease-renew',message:String(error)});}),40_000);
    try{
      if(route==='cloud')throw new ToolPolicyError('CLOUD_PROVIDER_NOT_CONFIGURED','cloud route is unavailable until an authorized provider is configured');
      if(route==='local_ai'){
        const prompt=stringValue(lease.job.payload.prompt)??lease.job.objective,json=boolValue(lease.job.payload.json,lease.job.expectedEvidence.includes('json'));
        const generated=await this.ollama.generate(prompt,{temperature:numberValue(lease.job.payload.temperature)??0.1,json});model=this.ollama.model;
        output={route,model,content:generated.content,parsedJson:generated.parsed,metrics:generated.metrics};tests.push({name:'ollama-generate',pass:true,metrics:generated.metrics});
      }else if(route==='tool'){
        const request=lease.job.payload.toolRequest,result=await this.executor.execute(request);commands.push(result);tests.push({name:'tool-exit-code',pass:result.exitCode===0,exitCode:result.exitCode});if(result.exitCode!==0)throw new ToolPolicyError('TOOL_EXIT_NONZERO',`tool exited with ${result.exitCode}`);output={route,result};
      }else{
        const action=stringValue(lease.job.payload.action);if(action==='resource_snapshot')output={route,resources:this.resources.snapshot()};else throw new ToolPolicyError('DETERMINISTIC_ACTION_REQUIRED','deterministic tasks require a supported structured action');
      }
      if(renewFailed)throw new ToolPolicyError('LEASE_RENEW_FAILED','lease renewal failed during execution');
      const evidenceDoc:EvidenceDocument={work_order_id:lease.job.jobId,worker:PC01_EMPLOYEE_ID,device:PC01_DEVICE_ID,started_at:startedAt,completed_at:new Date().toISOString(),input_task_summary:lease.job.objective,selected_route:route,model,commands_tools_executed:commands,test_results:tests,output_result:output,reviewer_gate_result:{independentReviewRequired:lease.job.independentReview,judgeRequired:lease.job.judgeRequired,claimedIndependentAiReview:false},errors_retries:errors,final_status:'completed'};
      const stored=await this.evidence.persist(evidenceDoc),evidence=this.evidenceFor(lease.job,stored.relativePath,stored.sha256);
      await this.client.submit(lease,{status:'completed',output,evidence,completedAt:evidenceDoc.completed_at});
      console.log(JSON.stringify({event:'PC01_JOB_DONE',jobId:lease.job.jobId,route,model,evidence:stored.relativePath}));
    }catch(error){
      const code=error instanceof ToolPolicyError?error.code:(error instanceof Error&&error.message.includes(':')?error.message.split(':')[0]:'PC01_EXECUTION_FAILED'),message=error instanceof Error?error.message:String(error);errors.push({phase:'execute',code,message});
      const evidenceDoc:EvidenceDocument={work_order_id:lease.job.jobId,worker:PC01_EMPLOYEE_ID,device:PC01_DEVICE_ID,started_at:startedAt,completed_at:new Date().toISOString(),input_task_summary:lease.job.objective,selected_route:route,model,commands_tools_executed:commands,test_results:tests,output_result:output,reviewer_gate_result:{independentReviewRequired:lease.job.independentReview,judgeRequired:lease.job.judgeRequired,claimedIndependentAiReview:false},errors_retries:errors,final_status:'failed'};
      const stored=await this.evidence.persist(evidenceDoc);try{await this.client.submit(lease,{status:'failed',evidence:[{kind:'json',ref:stored.relativePath,summary:'PC01 failure evidence',sha256:stored.sha256}],failure:{code,message:message.slice(0,2048),retriable:false},completedAt:evidenceDoc.completed_at});}catch(submitError){console.error(JSON.stringify({event:'PC01_RESULT_SUBMIT_ERROR',jobId:lease.job.jobId,message:String(submitError)}));}
      console.error(JSON.stringify({event:'PC01_JOB_FAILED',jobId:lease.job.jobId,code,message,evidence:stored.relativePath}));
    }finally{clearInterval(renewer);}
  }
  private evidenceFor(job:WorkerJob,ref:string,digest:string):Array<{kind:string;ref:string;summary:string;sha256:string}>{
    const supported=new Set(['json','log','text']);for(const kind of job.expectedEvidence)if(!supported.has(kind))throw new ToolPolicyError('EVIDENCE_KIND_UNSUPPORTED',`native worker cannot truthfully synthesize required evidence kind ${kind}`);
    return job.expectedEvidence.map(kind=>({kind,ref,summary:`PC01 native worker ${kind} evidence`,sha256:digest}));
  }
  private async sendHeartbeat():Promise<void>{if(!this.client)return;const resources=this.resources.snapshot();let ollama:Record<string,unknown>;try{ollama=await this.ollama.health();}catch(error){ollama={ok:false,error:String(error)};}const healthy=resources.freeRamBytes>=this.config.minFreeRamBytes&&ollama.ok===true;await this.client.heartbeat({resources,ollama,activeJobs:this.inflight.size,localAiActive:this.ollama.semaphore.activeCount,localAiMax:2,context:4096,model:this.ollama.model},healthy?'ok':'degraded');}
}

export function configFromEnv():NativeWorkerConfig{
  const workspace=path.resolve(process.env.TIGERIQ_WORKSPACE?.trim()||process.cwd()),stateRoot=process.env.TIGERIQ_PC01_STATE_DIR?.trim()||path.join(process.env.LOCALAPPDATA||workspace,'TigerIQ','pc01-native-worker'),ingressToken=(process.env.TIGERIQ_INGRESS_TOKEN??'').trim();
  if(ingressToken.length<32)throw new Error('TIGERIQ_INGRESS_TOKEN must contain at least 32 characters');
  return {workspace,identityFile:path.join(stateRoot,'identity.json'),controllerUrl:process.env.TIGERIQ_CONTROLLER_URL?.trim()||'http://100.97.23.87:8790',ingressToken,ollamaEndpoint:process.env.TIGERIQ_OLLAMA_URL?.trim()||'http://127.0.0.1:11434',ollamaModel:process.env.TIGERIQ_OLLAMA_MODEL?.trim()||'qwen3:8b',pollMs:Math.max(250,Number(process.env.TIGERIQ_WORKER_POLL_MS??1000)),heartbeatMs:Math.max(5000,Number(process.env.TIGERIQ_HEARTBEAT_MS??15000)),maxConcurrentJobs:Math.min(8,Math.max(1,Number(process.env.TIGERIQ_WORKER_MAX_JOBS??4))),minFreeRamBytes:Math.max(4,Number(process.env.TIGERIQ_MIN_FREE_RAM_GB??8))*1024**3};
}
