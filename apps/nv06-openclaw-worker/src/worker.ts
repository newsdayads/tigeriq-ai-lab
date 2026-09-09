import os from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ControllerClient } from './controller-client.js';
import { OpenClawExecutionError,OpenClawRunner } from './openclaw.js';
import { loadOrCreateIdentity,NV06_DEVICE_ID,NV06_EMPLOYEE_ID,sha256,sleep,type NV06Config,type WorkerJob,type WorkerLease } from './types.js';

export class NV06Worker {
  private stopped=false;private activeJobId:string|null=null;private client?:ControllerClient;private readonly runner:OpenClawRunner;
  constructor(readonly config:NV06Config){this.runner=new OpenClawRunner(config);}
  async start():Promise<void>{
    const identity=await loadOrCreateIdentity(this.config.identityFile);this.client=new ControllerClient(this.config.controllerUrl,this.config.ingressToken,identity);
    await this.client.register({hostname:os.hostname(),workerVersion:'nv06-openclaw-worker-v1',openclawAgent:'main',browserProfile:'chrome'});await this.heartbeat();
    const heartbeat=setInterval(()=>void this.heartbeat().catch(error=>console.error(JSON.stringify({event:'NV06_HEARTBEAT_ERROR',message:String(error)}))),this.config.heartbeatMs);
    try{while(!this.stopped){if(!this.activeJobId)await this.claimAndRun();await sleep(this.config.pollMs);}}finally{clearInterval(heartbeat);}
  }
  stop():void{this.stopped=true;}
  private async claimAndRun():Promise<void>{
    if(!this.client)return;let lease:WorkerLease|undefined;try{lease=await this.client.lease();}catch(error){console.error(JSON.stringify({event:'NV06_LEASE_ERROR',message:String(error)}));return;}
    if(!lease)return;this.activeJobId=lease.job.jobId;try{await this.executeLease(lease);}finally{this.activeJobId=null;}
  }
  private async executeLease(lease:WorkerLease):Promise<void>{
    if(!this.client)return;const startedAt=new Date().toISOString(),renewErrors:string[]=[];let renewFailed=false;
    const renewer=setInterval(()=>void this.client!.renew(lease).catch(error=>{renewFailed=true;renewErrors.push(String(error));}),90_000);
    try{
      if(!lease.job.requiredCapabilities.includes('browser.chatgpt'))throw new OpenClawExecutionError('NV06_CAPABILITY_MISMATCH','NV06 only executes browser.chatgpt jobs',false);
      const run=await this.runner.execute(lease.job);if(renewFailed)throw new OpenClawExecutionError('LEASE_RENEW_FAILED','Lease renewal failed during browser execution',true);
      const completedAt=new Date().toISOString(),output={route:'browser.chatgpt',worker:NV06_EMPLOYEE_ID,device:NV06_DEVICE_ID,sessionKey:run.sessionKey,browserUsed:run.browserUsed,durationMs:run.durationMs,text:run.text};
      const stored=await this.persistEvidence(lease.job,startedAt,completedAt,'completed',output,renewErrors);
      await this.client.submit(lease,{status:'completed',output,evidence:this.evidenceFor(lease.job,stored.ref,stored.digest),completedAt});
      console.log(JSON.stringify({event:'NV06_JOB_DONE',jobId:lease.job.jobId,sessionKey:run.sessionKey,durationMs:run.durationMs,evidence:stored.ref}));
    }catch(error){
      const code=error instanceof OpenClawExecutionError?error.code:'NV06_EXECUTION_FAILED',message=error instanceof Error?error.message:String(error),retriable=error instanceof OpenClawExecutionError?error.retriable:true,completedAt=new Date().toISOString();
      const stored=await this.persistEvidence(lease.job,startedAt,completedAt,'failed',{code,message},renewErrors);
      try{await this.client.submit(lease,{status:'failed',evidence:[{kind:'json',ref:stored.ref,summary:'NV06 failure evidence',sha256:stored.digest}],failure:{code,message:message.slice(0,2048),retriable},completedAt});}catch(submitError){console.error(JSON.stringify({event:'NV06_RESULT_SUBMIT_ERROR',jobId:lease.job.jobId,message:String(submitError)}));}
      console.error(JSON.stringify({event:'NV06_JOB_FAILED',jobId:lease.job.jobId,code,retriable,message,evidence:stored.ref}));
    }finally{clearInterval(renewer);}
  }
  private async persistEvidence(job:WorkerJob,startedAt:string,completedAt:string,status:'completed'|'failed',output:Record<string,unknown>,renewErrors:string[]):Promise<{ref:string;digest:string}>{
    const safe=job.jobId.replace(/[^A-Za-z0-9._-]/g,'_'),dir=path.join(this.config.workspace,'.tigeriq-runtime','evidence',safe);await mkdir(dir,{recursive:true});
    const absolute=path.join(dir,`${Date.now()}-nv06-${status}.json`),document={work_order_id:job.jobId,worker:NV06_EMPLOYEE_ID,device:NV06_DEVICE_ID,started_at:startedAt,completed_at:completedAt,selected_route:'browser.chatgpt',output_result:output,lease_renew_errors:renewErrors,final_status:status};
    const raw=`${JSON.stringify(document,null,2)}\n`;await writeFile(absolute,raw,'utf8');return {ref:path.relative(this.config.workspace,absolute).replaceAll('\\','/'),digest:sha256(raw)};
  }
  private evidenceFor(job:WorkerJob,ref:string,digest:string):Array<{kind:'text'|'json'|'log';ref:string;summary:string;sha256:string}>{
    const supported=new Set(['json','log','text']);const kinds=job.expectedEvidence.length?job.expectedEvidence:['json'];
    if(kinds.some(kind=>!supported.has(kind)))throw new OpenClawExecutionError('EVIDENCE_KIND_UNSUPPORTED','NV06 supports text/json/log evidence only',false);
    return kinds.map(kind=>({kind:kind as 'text'|'json'|'log',ref,summary:`NV06 OpenClaw ${kind} evidence`,sha256:digest}));
  }
  private async heartbeat():Promise<void>{if(!this.client)return;await this.client.heartbeat({service:'nv06-openclaw-worker-v1',pid:process.pid,hostname:os.hostname(),activeJobId:this.activeJobId,openclawAgent:'main',browserProfile:'chrome',concurrency:1},'ok');}
}
