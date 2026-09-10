import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const baseUrl=process.env.TIGERIQ_CONTROLLER_URL?.trim()||'http://100.97.23.87:8790';
const workspace=path.resolve(process.env.TIGERIQ_WORKSPACE?.trim()||'D:/TigerIQ/Workspace/tigeriq-ai-lab');
const runtime=path.resolve(process.env.TIGERIQ_AI_RESOURCE_RUNTIME?.trim()||'D:/TigerIQ/Runtime/ai-resource-worker');
const distRoot=path.resolve(process.env.TIGERIQ_AI_DIST_ROOT?.trim()||path.join(workspace,'dist'));
const ollamaEndpoint=process.env.TIGERIQ_OLLAMA_URL?.trim()||'http://127.0.0.1:11434';
const ingress=(process.env.TIGERIQ_INGRESS_TOKEN?.trim()||await readFile('D:/TigerIQ/Secrets/pc01-primary-node.ingress-token','utf8')).trim();
const employeeId='EMP-AI-RESOURCE';
const deviceId='DEV-PC01-AI-RESOURCE';
const bindingId='BIND-PC01-AI-RESOURCE';
const nodeId='PC01-AI-RESOURCE';
const capabilities=['ai_resource','ai','cloud_ai','local_ai','groq','gemini','ollama','evidence'];
const permissions=['cloud_ai:execute','local_ai:execute','evidence:write'];
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=value=>createHash('sha256').update(value).digest('hex');

const {ControllerClient}=await import(pathToFileURL(path.join(distRoot,'apps','pc01-native-worker','src','controller-client.js')).href);
const {CoordinatedAiProvider}=await import(pathToFileURL(path.join(distRoot,'apps','pc01-native-worker','src','coordinated-ai.js')).href);
async function loadIdentity(){
  const file=path.join(runtime,'state','identity.json');
  try{return JSON.parse(await readFile(file,'utf8'));}catch{}
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1',publicKeyEncoding:{type:'spki',format:'der'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  const publicKeyBase64=pair.publicKey.toString('base64');
  const identity={employeeId,deviceId,bindingId,nodeId,publicKeyBase64,publicKeyFingerprint:sha(pair.publicKey),privateKeyPem:pair.privateKey};
  await mkdir(path.dirname(file),{recursive:true});
  await writeFile(file,JSON.stringify(identity,null,2),'utf8');
  return identity;
}

const identity=await loadIdentity();
const client=new ControllerClient(baseUrl,ingress,identity);
const provider=new CoordinatedAiProvider(path.join(runtime,'state'),ollamaEndpoint);

async function register(){
  const body={employeeId,deviceId,bindingId,nodeId,displayName:'TigerIQ AI Resource Worker',platform:'windows-pc01',publicKeyBase64:identity.publicKeyBase64,publicKeyFingerprint:identity.publicKeyFingerprint,capabilities,permissions,concurrencyLimit:1,metadata:{resourceSelector:'capability+availability+zero-cost',providers:['groq','gemini','ollama'],logicalEmployeeBinding:'dynamic'}};
  const response=await fetch(`${baseUrl}/api/v1/pc01/register`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${ingress}`},body:JSON.stringify(body)});
  if(!response.ok)throw new Error(`REGISTER_${response.status}`);
}
async function persist(job,result,startedAt,completedAt,status,error){
  const dir=path.join(workspace,'.tigeriq-runtime','evidence',job.jobId);
  await mkdir(dir,{recursive:true});
  const file=path.join(dir,`${Date.now()}-${status}.json`);
  const raw=JSON.stringify({work_order_id:job.jobId,worker:employeeId,device:deviceId,selected_route:'ai_resource',resource_selector:'capability+availability+zero-cost',started_at:startedAt,completed_at:completedAt,final_status:status,executor_model:result?.executorModel,verification_mode:result?.verificationMode,attempts:result?.evidence?.attempts,error},null,2);
  await writeFile(file,raw,'utf8');
  return {ref:path.relative(workspace,file).replaceAll('\\','/'),sha256:sha(raw)};
}

async function executeLease(lease){
  const startedAt=new Date().toISOString();let renewFailed=false;
  const renewer=setInterval(()=>void client.renew(lease).catch(()=>{renewFailed=true}),40000);
  try{
    const result=await provider.run(lease.job);
    if(renewFailed)throw new Error('LEASE_RENEW_FAILED');
    const completedAt=new Date().toISOString();
    const evidence=await persist(lease.job,result,startedAt,completedAt,'completed');
    const [selectedProvider,...modelParts]=result.executorModel.split('/');
    const output={route:'ai_resource',resourceSelector:'capability+availability+zero-cost',provider:selectedProvider,model:modelParts.join('/'),content:result.content,verificationMode:result.verificationMode,reviewerDecision:result.reviewerDecision,judgeDecision:result.judgeDecision,attempts:result.evidence.attempts};
    await client.submit(lease,{status:'completed',output,evidence:[{kind:'json',ref:evidence.ref,summary:'AI resource routing evidence',sha256:evidence.sha256}],completedAt});
    console.log(JSON.stringify({event:'AI_RESOURCE_JOB_DONE',jobId:lease.job.jobId,provider:selectedProvider,model:modelParts.join('/'),verificationMode:result.verificationMode,evidence:evidence.ref}));
  }catch(error){
    const completedAt=new Date().toISOString();const message=error instanceof Error?error.message:String(error);
    const evidence=await persist(lease.job,undefined,startedAt,completedAt,'failed',message.slice(0,1000));
    try{await client.submit(lease,{status:'failed',evidence:[{kind:'json',ref:evidence.ref,summary:'AI resource failure evidence',sha256:evidence.sha256}],failure:{code:'AI_RESOURCE_EXECUTION_FAILED',message:message.slice(0,1000),retriable:true},completedAt});}catch{}
    console.error(JSON.stringify({event:'AI_RESOURCE_JOB_FAILED',jobId:lease.job.jobId,message:message.slice(0,300)}));
  }finally{clearInterval(renewer);}
}

let stopping=false;
process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
await register();
console.log(JSON.stringify({event:'AI_RESOURCE_WORKER_START',employeeId,deviceId,providers:['groq','gemini','ollama'],zeroCostOnly:true}));
let nextHeartbeat=0;
while(!stopping){
  try{
    if(Date.now()>=nextHeartbeat){await client.heartbeat({providers:{groq:Boolean(process.env.GROQ_API_KEY)&&process.env.TIGERIQ_GROQ_FREE_TIER_VERIFIED==='true',gemini:Boolean(process.env.GEMINI_API_KEY)&&process.env.TIGERIQ_GEMINI_FREE_TIER_VERIFIED==='true',ollama:true},resourceSelector:'capability+availability+zero-cost'},'ok');nextHeartbeat=Date.now()+15000;}
    const lease=await client.lease();
    if(lease){await executeLease(lease);continue;}
  }catch(error){console.error(JSON.stringify({event:'AI_RESOURCE_LOOP_ERROR',message:error instanceof Error?error.message:String(error)}));}
  await sleep(1000);
}
console.log(JSON.stringify({event:'AI_RESOURCE_WORKER_STOP'}));
