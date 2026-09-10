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
const capabilities=['groq','cloud_ai','ai','evidence','review','judge'];
const permissions=['cloud_ai:execute','local_ai:execute','evidence:write'];
const client=new ControllerClient(baseUrl,ingress,identity);
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const sha=(v)=>createHash('sha256').update(v).digest('hex');

async function register(){
  const body={employeeId:'NV02',deviceId:'DEV-PC01-NV02',bindingId:'BIND-PC01-NV02',nodeId:'PC01-NV02',displayName:'Khoa · NV02 Groq Worker',platform:'windows-pc01',publicKeyBase64:identity.publicKeyBase64,publicKeyFingerprint:identity.publicKeyFingerprint,capabilities,permissions,concurrencyLimit:1,metadata:{provider:'groq',mode:'background_auto',assurance:'groq+ollama-review+ollama-judge'}};
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
async function invokeOllama(model,prompt){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),120000);
  try{
    const r=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,prompt,stream:false,think:false,options:{temperature:0,num_predict:16,num_ctx:2048}}),signal:controller.signal});
    if(!r.ok) throw new Error(`OLLAMA_${model}_HTTP_${r.status}`);
    const j=await r.json();
    return String(j.response??'').trim();
  }finally{clearTimeout(timer);}
}

async function assure(job,prompt,content){
  const needReview=job.payload?.requireAssurance!==false;
  const needJudge=job.payload?.requireJudge!==false;
  if(!needReview) return {required:false};
  const reviewerPrompt=`You are an independent reviewer. Check whether OUTPUT satisfies TASK. Return exactly PASS or FAIL.\nTASK:\n${prompt}\nOUTPUT:\n${content}`;
  const reviewerText=await invokeOllama('gemma3:4b',reviewerPrompt);
  const reviewerVerdict=reviewerText.toUpperCase()==='PASS'?'PASS':'FAIL';
  if(reviewerVerdict!=='PASS') throw new Error('INDEPENDENT_REVIEW_FAILED');
  let judgeVerdict='NOT_REQUIRED';
  if(needJudge){
    const judgePrompt=`You are the final independent judge. TASK, OUTPUT and REVIEW are below. Return exactly PASS or FAIL.\nTASK:\n${prompt}\nOUTPUT:\n${content}\nREVIEW:${reviewerVerdict}`;
    const judgeText=await invokeOllama('qwen3:8b',judgePrompt);
    judgeVerdict=judgeText.toUpperCase()==='PASS'?'PASS':'FAIL';
    if(judgeVerdict!=='PASS') throw new Error('INDEPENDENT_JUDGE_FAILED');
  }
  return {required:true,reviewer:{identity:'ollama:gemma3:4b',verdict:reviewerVerdict},judge:{identity:'ollama:qwen3:8b',verdict:judgeVerdict}};
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
  const job=lease.job; const startedAt=new Date().toISOString(); let renewFailed=false;
  const renewer=setInterval(()=>void client.renew(lease).catch(()=>{renewFailed=true}),40000);
  try{
    const prompt=String(job.payload?.prompt??job.objective??'').trim();
    if(!prompt) throw new Error('PROMPT_REQUIRED');
    const groq=await invokeGroq(prompt,path.join(runtime,'jobs',job.jobId));
    const assurance=await assure(job,prompt,groq.content);
    if(renewFailed) throw new Error('LEASE_RENEW_FAILED');
    const completedAt=new Date().toISOString();
    const evidence=await persistEvidence(job,startedAt,completedAt,'completed',{model:groq.model,prompt_sha256:sha(prompt),output_sha256:sha(groq.content),usage:groq.usage,assurance});
    const output={route:'groq',provider:'groq',model:groq.model,content:groq.content,usage:groq.usage,assurance};
    await client.submit(lease,{status:'completed',output,evidence:[{kind:'json',ref:evidence.ref,summary:'NV02 Groq execution + assurance evidence',sha256:evidence.sha256}],completedAt});
    console.log(JSON.stringify({event:'NV02_GROQ_JOB_DONE',jobId:job.jobId,model:groq.model,reviewer:assurance.reviewer?.identity,judge:assurance.judge?.identity,evidence:evidence.ref}));
  }catch(error){
    const completedAt=new Date().toISOString(); const message=error instanceof Error?error.message:String(error);
    const evidence=await persistEvidence(job,startedAt,completedAt,'failed',{error:message.slice(0,2000)});
    try{await client.submit(lease,{status:'failed',evidence:[{kind:'json',ref:evidence.ref,summary:'NV02 Groq failure evidence',sha256:evidence.sha256}],failure:{code:'GROQ_EXECUTION_FAILED',message:message.slice(0,2000),retriable:!['PROMPT_REQUIRED','INDEPENDENT_REVIEW_FAILED','INDEPENDENT_JUDGE_FAILED'].includes(message)},completedAt});}catch{}
    console.error(JSON.stringify({event:'NV02_GROQ_JOB_FAILED',jobId:job.jobId,message:message.slice(0,500)}));
  }finally{clearInterval(renewer);}
}
let stopping=false;
process.on('SIGINT',()=>{stopping=true}); process.on('SIGTERM',()=>{stopping=true});
await register();
console.log(JSON.stringify({event:'NV02_GROQ_WORKER_START',employeeId:'NV02',deviceId:'DEV-PC01-NV02',provider:'groq',assurance:'ollama-review-judge'}));
let nextHeartbeat=0;
while(!stopping){
  try{
    if(Date.now()>=nextHeartbeat){await client.heartbeat({provider:'groq',mode:'background_auto',assurance:'ollama-review-judge'},'ok');nextHeartbeat=Date.now()+15000;}
    const lease=await client.lease();
    if(lease){await executeLease(lease);continue;}
  }catch(error){console.error(JSON.stringify({event:'NV02_GROQ_LOOP_ERROR',message:error instanceof Error?error.message:String(error)}));}
  await sleep(1000);
}
console.log(JSON.stringify({event:'NV02_GROQ_WORKER_STOP'}));
