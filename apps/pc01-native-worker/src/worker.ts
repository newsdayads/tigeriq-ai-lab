import os from 'node:os';
import { ControllerClient } from './controller-client.js';
import { ToolExecutor, ToolPolicyError } from './executor.js';
import { OllamaProvider } from './ollama.js';
import { boolValue, CapabilityRouter, EvidenceStore, loadOrCreateIdentity, numberValue, PC01_DEVICE_ID, PC01_EMPLOYEE_ID, ResourceMonitor, sleep, stringValue, type EvidenceDocument, type NativeWorkerConfig, type WorkerJob, type WorkerLease } from './types.js';

export class NativeWorker {
  readonly resources=new ResourceMonitor();readonly router=new CapabilityRouter();readonly executor:ToolExecutor;readonly evidence:EvidenceStore;readonly ollama:OllamaProvider;
  private readonly inflight=new Map<string,Promise<void>>();private stopped=false;private client?:ControllerClient;
  constructor(readonly config:NativeWorkerConfig){this.executor=new ToolExecutor(config.workspace);this.evidence=new EvidenceStore(config.workspace);this.ollama=new OllamaProvider(config.ollamaEndpoint,config.ollamaModel,4096,2);}
  async start():Promise<void>{
    const identity=await loadOrCreateIdentity(this.config.identityFile);this.client=new ControllerClient(this.config.controllerUrl,this.config.ingressToken,identity);
    const ollamaHealth=await this.ollama.health();await this.client.register({hostname:os.hostname(),workspace:this.config.workspace,ollama:ollamaHealth,workerVersion:'pc01-native-worker-v1'});await this.sendHeartbeat();
    const heartbeat=setInterval(()=>void this.sendHeartbeat().catch(error=>console.error(JSON.stringify({event:'PC01_HEARTBEAT_ERROR',message:String(error)}))),this.config.heartbeatMs);
    try{while(!this.stopped){await this.fillCapacity();await sleep(this.config.pollMs);}}finally{clearInterval(heartbeat);await Promise.allSettled(this.inflight.values());}
  }
  stop():void{this.stopped=true;}
  private async fillCapacity():Promise<void>{
    if(!this.client)return;const snapshot=this.resources.snapshot();if(snapshot.freeRamBytes<this.config.minFreeRamBytes)return;
    while(this.inflight.size<this.config.maxConcurrentJobs&&!this.stopped){let lease:WorkerLease|undefined;try{lease=await this.client.lease();}catch(error){console.error(JSON.stringify({event:'PC01_LEASE_ERROR',message:String(error)}));return;}if(!lease)return;if(this.inflight.has(lease.job.jobId))continue;const work=this.executeLease(lease).finally(()=>this.inflight.delete(lease.job.jobId));this.inflight.set(lease.job.jobId,work);}
  }
  private async executeLease(lease:WorkerLease):Promise<void>{
    if(!this.client)return;const startedAt=new Date().toISOString(),route=this.router.select(lease.job),commands:unknown[]=[],tests:unknown[]=[],errors:unknown[]=[];let model:string|undefined,output:Record<string,unknown>|undefined,renewFailed=false;
    const renewer=setInterval(()=>void this.client!.renew(lease).catch(error=>{renewFailed=true;errors.push({phase:'lease-renew',message:String(error)});}),40_000);
    try{
      if(route==='cloud')throw new ToolPolicyError('CLOUD_PROVIDER_NOT_CONFIGURED','cloud route is unavailable until an authorized provider is configured');
      if(route==='local_ai'){
        const prompt=stringValue(lease.job.payload.prompt)??lease.job.objective,json=boolValue(lease.job.payload.json,lease.job.expectedEvidence.includes('json')),generated=await this.ollama.generate(prompt,{temperature:numberValue(lease.job.payload.temperature)??0.1,json});model=this.ollama.model;
        output={route,model,content:generated.content,parsedJson:generated.parsed,metrics:generated.metrics};tests.push({name:'ollama-generate',pass:true,metrics:generated.metrics});
      }else if(route==='tool'){
        const rawRequests=Array.isArray(lease.job.payload.toolRequests)?lease.job.payload.toolRequests:[lease.job.payload.toolRequest],results=[];
        if(rawRequests.length===0||rawRequests.length>16||rawRequests.some(value=>value===undefined))throw new ToolPolicyError('TOOL_REQUEST_INVALID','tool route requires 1-16 structured tool requests');
        for(const request of rawRequests){const result=await this.executor.execute(request);results.push(result);commands.push(result);tests.push({name:'tool-exit-code',pass:result.exitCode===0,exitCode:result.exitCode,operation:result.operation});if(result.exitCode!==0)throw new ToolPolicyError('TOOL_EXIT_NONZERO',`tool exited with ${result.exitCode}`);}
        output={route,results};
      }else{
        const action=stringValue(lease.job.payload.action);if(action==='resource_snapshot')output={route,resources:this.resources.snapshot()};else throw new ToolPolicyError('DETERMINISTIC_ACTION_REQUIRED','deterministic tasks require a supported structured action');
      }
      if(renewFailed)throw new ToolPolicyError('LEASE_RENEW_FAILED','lease renewal failed during execution');
      const completedAt=new Date().toISOString(),evidenceDoc=this.document(lease.job,startedAt,completedAt,route,model,commands,tests,errors,output,'completed'),stored=await this.evidence.persist(evidenceDoc),evidence=this.evidenceFor(lease.job,stored.relativePath,stored.sha256);
      await this.client.submit(lease,{status:'completed',output,evidence,completedAt});console.log(JSON.stringify({event:'PC01_JOB_DONE',jobId:lease.job.jobId,route,model,evidence:stored.relativePath}));
    }catch(error){
      const code=error instanceof ToolPolicyError?error.code:error instanceof Error&&error.message.includes(':')?error.message.split(':')[0]:'PC01_EXECUTION_FAILED',message=error instanceof Error?error.message:String(error);errors.push({phase:'execute',code,message});
      const completedAt=new Date().toISOString(),evidenceDoc=this.document(lease.job,startedAt,completedAt,route,model,commands,tests,errors,output,'failed'),stored=await this.evidence.persist(evidenceDoc);
      try{await this.client.submit(lease,{status:'failed',evidence:[{kind:'json',ref:stored.relativePath,summary:'PC01 failure evidence',sha256:stored.sha256}],failure:{code,message:message.slice(0,2048),retriable:false},completedAt});}catch(submitError){console.error(JSON.stringify({event:'PC01_RESULT_SUBMIT_ERROR',jobId:lease.job.jobId,message:String(submitError)}));}
      console.error(JSON.stringify({event:'PC01_JOB_FAILED',jobId:lease.job.jobId,code,message,evidence:stored.relativePath}));
    }finally{clearInterval(renewer);}
  }
  private document(job:WorkerJob,startedAt:string,completedAt:string,route:string,model:string|undefined,commands:unknown[],tests:unknown[],errors:unknown[],output:Record<string,unknown>|undefined,finalStatus:'completed'|'failed'):EvidenceDocument{return {work_order_id:job.jobId,worker:PC01_EMPLOYEE_ID,device:PC01_DEVICE_ID,started_at:startedAt,completed_at:completedAt,input_task_summary:job.objective,selected_route:route,model,commands_tools_executed:commands,test_results:tests,output_result:output,reviewer_gate_result:{independentReviewRequired:job.independentReview,judgeRequired:job.judgeRequired,claimedIndependentAiReview:false},errors_retries:errors,final_status:finalStatus};}
  private evidenceFor(job:WorkerJob,ref:string,digest:string):Array<{kind:'text'|'json'|'log';ref:string;summary:string;sha256:string}>{const supported=new Set(['json','log','text']);for(const kind of job.expectedEvidence)if(!supported.has(kind))throw new ToolPolicyError('EVIDENCE_KIND_UNSUPPORTED',`native worker cannot truthfully synthesize required evidence kind ${kind}`);return job.expectedEvidence.map(kind=>({kind:kind as 'text'|'json'|'log',ref,summary:`PC01 native worker ${kind} evidence`,sha256:digest}));}
  private async sendHeartbeat():Promise<void>{if(!this.client)return;const resources=this.resources.snapshot();let ollama:Record<string,unknown>;try{ollama=await this.ollama.health();}catch(error){ollama={ok:false,error:String(error)};}const healthy=resources.freeRamBytes>=this.config.minFreeRamBytes&&ollama.ok===true;await this.client.heartbeat({resources,ollama,activeJobs:this.inflight.size,localAiActive:this.ollama.semaphore.activeCount,localAiMax:2,context:4096,model:this.ollama.model},healthy?'ok':'degraded');}
}
