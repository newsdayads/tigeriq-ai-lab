import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ControllerClient } from '../../pc01-native-worker/src/controller-client.js';
import { EvidenceStore, loadOrCreateIdentity, sleep, stringValue, type EvidenceDocument, type WorkerLease } from '../../pc01-native-worker/src/types.js';
import { HumanAuthRequired, OpenClawChatGptExecutor } from './browser-executor.js';

const EMPLOYEE_ID='EMP-NV06-OPENCLAW';
const DEVICE_ID='DEV-NV06-OPENCLAW';
const BINDING_ID='BIND-NV06-OPENCLAW';
const workspace=path.resolve(process.env.TIGERIQ_WORKSPACE?.trim()||'D:\\TigerIQ\\Workspace\\tigeriq-ai-lab');
const stateRoot=process.env.TIGERIQ_NV06_STATE_DIR?.trim()||'D:\\TigerIQ\\Runtime\\nv06-openclaw-worker\\state';
const controllerUrl=process.env.TIGERIQ_CONTROLLER_URL?.trim()||'http://100.97.23.87:8790';
const ingressToken=(process.env.TIGERIQ_INGRESS_TOKEN??readFileSync('D:\\TigerIQ\\Secrets\\pc01-primary-node.ingress-token','utf8')).trim();
const pollMs=Math.max(1000,Number(process.env.TIGERIQ_NV06_POLL_MS??3000));
const heartbeatMs=Math.max(5000,Number(process.env.TIGERIQ_NV06_HEARTBEAT_MS??15000));
let stopped=false;

function taskText(lease:WorkerLease):string{return stringValue(lease.job.payload.prompt)??stringValue(lease.job.payload.task)??lease.job.objective;}

async function executeLease(client:ControllerClient,evidence:EvidenceStore,browser:OpenClawChatGptExecutor,lease:WorkerLease):Promise<void>{
  const startedAt=new Date().toISOString();let output:Record<string,unknown>|undefined;let errorInfo:unknown;
  const renewer=setInterval(()=>void client.renew(lease).catch(error=>console.error(JSON.stringify({event:'NV06_RENEW_ERROR',jobId:lease.job.jobId,message:String(error)}))),60_000);
  try{
    if(!lease.job.requiredCapabilities.includes('browser.chatgpt'))throw new Error('NV06_CAPABILITY_MISMATCH');
    const result=await browser.execute(lease.job.jobId,taskText(lease));
    output={route:'browser.chatgpt',provider:'chatgpt-web',content:result.content,marker:result.marker,tabUrl:result.tabUrl};
    const completedAt=new Date().toISOString();
    const doc:EvidenceDocument={work_order_id:lease.job.jobId,worker:EMPLOYEE_ID,device:DEVICE_ID,started_at:startedAt,completed_at:completedAt,input_task_summary:lease.job.objective,selected_route:'browser.chatgpt',commands_tools_executed:[{tool:'openclaw-browser',tabId:result.tabId,tabUrl:result.tabUrl}],test_results:[{name:'chatgpt-marker',pass:result.content.includes(result.marker),marker:result.marker}],output_result:output,reviewer_gate_result:{independentReviewRequired:lease.job.independentReview,judgeRequired:lease.job.judgeRequired,claimedIndependentAiReview:false},errors_retries:[],final_status:'completed'};
    const stored=await evidence.persist(doc);
    await client.submit(lease,{status:'completed',output,evidence:[{kind:'json',ref:stored.relativePath,summary:'NV06 OpenClaw/ChatGPT result evidence',sha256:stored.sha256}],completedAt});
    console.log(JSON.stringify({event:'NV06_JOB_DONE',jobId:lease.job.jobId,marker:result.marker,evidence:stored.relativePath}));
  }catch(error){
    errorInfo=error;const code=error instanceof HumanAuthRequired?error.code:error instanceof Error&&error.message.includes(':')?error.message.split(':')[0]:'NV06_EXECUTION_FAILED';const message=error instanceof Error?error.message:String(error);const completedAt=new Date().toISOString();
    const doc:EvidenceDocument={work_order_id:lease.job.jobId,worker:EMPLOYEE_ID,device:DEVICE_ID,started_at:startedAt,completed_at:completedAt,input_task_summary:lease.job.objective,selected_route:'browser.chatgpt',commands_tools_executed:[],test_results:[],output_result:output,reviewer_gate_result:{independentReviewRequired:lease.job.independentReview,judgeRequired:lease.job.judgeRequired,claimedIndependentAiReview:false},errors_retries:[{code,message}],final_status:'failed'};
    const stored=await evidence.persist(doc);
    try{await client.submit(lease,{status:'failed',evidence:[{kind:'json',ref:stored.relativePath,summary:'NV06 failure evidence',sha256:stored.sha256}],failure:{code,message:message.slice(0,2048),retriable:code!=='BLOCKED_HUMAN_AUTH'},completedAt});}catch(submitError){console.error(JSON.stringify({event:'NV06_RESULT_SUBMIT_ERROR',jobId:lease.job.jobId,message:String(submitError)}));}
    console.error(JSON.stringify({event:'NV06_JOB_FAILED',jobId:lease.job.jobId,code,message,evidence:stored.relativePath}));
  }finally{clearInterval(renewer);void errorInfo;}
}
export async function startNv06Worker():Promise<void>{
  const identity=await loadOrCreateIdentity(path.join(stateRoot,'identity.json'),{employeeId:EMPLOYEE_ID,deviceId:DEVICE_ID,bindingId:BINDING_ID,nodeId:'PC01-NV06'});
  const client=new ControllerClient(controllerUrl,ingressToken,identity,{displayName:'NV06 OpenClaw Browser Worker',platform:'windows-pc01-openclaw',capabilities:['browser.chatgpt','continuity.signal','evidence'],permissions:['browser:chatgpt','evidence:write'],concurrencyLimit:1,leaseTtlMs:300_000});
  const evidence=new EvidenceStore(workspace),browser=new OpenClawChatGptExecutor();
  await client.register({service:'nv06-openclaw-worker-v1',workspace,concurrency:1});
  const heartbeat=async()=>client.heartbeat({service:'nv06-openclaw-worker-v1',pid:process.pid,capability:'browser.chatgpt',concurrency:1});
  await heartbeat();const timer=setInterval(()=>void heartbeat().catch(error=>console.error(JSON.stringify({event:'NV06_HEARTBEAT_ERROR',message:String(error)}))),heartbeatMs);
  console.log(JSON.stringify({event:'NV06_WORKER_START',employeeId:EMPLOYEE_ID,deviceId:DEVICE_ID,pollMs}));
  try{while(!stopped){let lease:WorkerLease|undefined;try{lease=await client.lease();}catch(error){console.error(JSON.stringify({event:'NV06_LEASE_ERROR',message:String(error)}));await sleep(pollMs);continue;}if(!lease){await sleep(pollMs);continue;}await executeLease(client,evidence,browser,lease);}}
  finally{clearInterval(timer);}
}

process.once('SIGINT',()=>{stopped=true;});process.once('SIGTERM',()=>{stopped=true;});
const invokedAsMain=Boolean(process.argv[1])&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(invokedAsMain)startNv06Worker().catch(error=>{console.error(JSON.stringify({event:'NV06_WORKER_FATAL',message:error instanceof Error?error.message:String(error)}));process.exit(1);});
