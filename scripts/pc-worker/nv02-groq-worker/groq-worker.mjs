import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ControllerClient } from 'file:///D:/TigerIQ/AutonomyRuntime/tigeriq-fast-20260903-174812/dist/apps/pc01-native-worker/src/controller-client.js';

const baseUrl='http://100.97.23.87:8790';
const workspace='D:/TigerIQ/Workspace/tigeriq-ai-lab';
const runtime='D:/TigerIQ/Runtime/nv02-worker';
const identity=JSON.parse(await readFile(`${runtime}/state/identity.json`,'utf8'));
const ingress=(await readFile('D:/TigerIQ/Secrets/pc01-primary-node.ingress-token','utf8')).trim();
const capabilities=['groq','cloud_ai','ai','evidence'];
const permissions=['cloud_ai:execute','evidence:write'];
const client=new ControllerClient(baseUrl,ingress,identity);
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const sha=(v)=>createHash('sha256').update(v).digest('hex');

async function register(){
  const body={employeeId:'NV02',deviceId:'DEV-PC01-NV02',bindingId:'BIND-PC01-NV02',nodeId:'PC01-NV02',displayName:'Khoa · NV02 Groq Worker',platform:'windows-pc01',publicKeyBase64:identity.publicKeyBase64,publicKeyFingerprint:identity.publicKeyFingerprint,capabilities,permissions,concurrencyLimit:1,metadata:{provider:'groq',mode:'background_auto'}};
  const r=await fetch(`${baseUrl}/api/v1/pc01/register`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${ingress}`},body:JSON.stringify(body)});
  if(!r.ok) throw new Error(`REGISTER_${r.status}`);
}
async function invokeGroq(prompt,jobDir){
  await mkdir(jobDir,{recursive:true});
  const promptPath=path.join(jobDir,'prompt.txt');
  const outputPath=path.join(jobDir,'groq-result.json');
  await writeFile(promptPath,prompt,'utf8');
  await new Promise((resolve,reject)=>{
    const p=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',`${runtime}/invoke-groq-prompt.ps1`,'-PromptPath',promptPath,'-OutputPath',outputPath,'-TimeoutSeconds','90'],{windowsHide:true});
    let err=''; p.stderr.on('data',d=>{err+=d.toString()});
    p.on('error',reject); p.on('exit',code=>code===0?resolve():reject(new Error(`GROQ_EXIT_${code}:${err.slice(-1500)}`)));
  });
  const raw=(await readFile(outputPath,'utf8')).replace(/^\uFEFF/,'');
  const result=JSON.parse(raw);
  if(!result.ok||result.provider!=='groq') throw new Error('GROQ_RESULT_INVALID');
  return result;
}

async function persistEvidence(job,startedAt,completedAt,status,data){
  const dir=path.join(workspace,'.tigeriq-runtime','evidence',job.jobId);
  await mkdir(dir,{recursive:true});
  const file=path.join(dir,`${Date.now()}-${status}.json`);
  const doc={work_order_id:job.jobId,worker:'NV02',device:'DEV-PC01-NV02',provider:'groq',selected_route:'groq',started_at:startedAt,completed_at:completedAt,final_status:status,...data};
  const raw=JSON.stringify(doc,null,2); await writeFile(file,raw,'utf8');
  return {ref:path.relative(workspace,file).replaceAll('\\','/'),sha256:sha(raw)};
}
async function executeLease(lease){
  const job=lease.job; const startedAt=new Date().toISOString();
  try{
    const prompt=String(job.payload?.prompt??job.objective??'').trim();
    if(!prompt) throw new Error('PROMPT_REQUIRED');
    const groq=await invokeGroq(prompt,path.join(runtime,'jobs',job.jobId));
    const completedAt=new Date().toISOString();
    const evidence=await persistEvidence(job,startedAt,completedAt,'completed',{model:groq.model,prompt_sha256:sha(prompt),output_sha256:sha(groq.content),usage:groq.usage});
    const output={route:'groq',provider:'groq',model:groq.model,content:groq.content,usage:groq.usage};
    await client.submit(lease,{status:'completed',output,evidence:[{kind:'json',ref:evidence.ref,summary:'NV02 Groq execution evidence',sha256:evidence.sha256}],completedAt});
    console.log(JSON.stringify({event:'NV02_GROQ_JOB_DONE',jobId:job.jobId,model:groq.model,evidence:evidence.ref}));
  }catch(error){
    const completedAt=new Date().toISOString(); const message=error instanceof Error?error.message:String(error);
    const evidence=await persistEvidence(job,startedAt,completedAt,'failed',{error:message.slice(0,2000)});
    try{await client.submit(lease,{status:'failed',evidence:[{kind:'json',ref:evidence.ref,summary:'NV02 Groq failure evidence',sha256:evidence.sha256}],failure:{code:'GROQ_EXECUTION_FAILED',message:message.slice(0,2000),retriable:true},completedAt});}catch{}
    console.error(JSON.stringify({event:'NV02_GROQ_JOB_FAILED',jobId:job.jobId,message:message.slice(0,500)}));
  }
}
let stopping=false;
process.on('SIGINT',()=>{stopping=true}); process.on('SIGTERM',()=>{stopping=true});
await register();
console.log(JSON.stringify({event:'NV02_GROQ_WORKER_START',employeeId:'NV02',deviceId:'DEV-PC01-NV02',provider:'groq'}));
let nextHeartbeat=0;
while(!stopping){
  try{
    if(Date.now()>=nextHeartbeat){await client.heartbeat({provider:'groq',mode:'background_auto'},'ok');nextHeartbeat=Date.now()+15000;}
    const lease=await client.lease();
    if(lease){await executeLease(lease);continue;}
  }catch(error){console.error(JSON.stringify({event:'NV02_GROQ_LOOP_ERROR',message:error instanceof Error?error.message:String(error)}));}
  await sleep(1000);
}
console.log(JSON.stringify({event:'NV02_GROQ_WORKER_STOP'}));
