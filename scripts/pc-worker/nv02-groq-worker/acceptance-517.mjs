import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const base=process.env.TIGERIQ_WORKFORCE_CONTROLLER_URL||'http://100.97.23.87:8790';
const token=process.env.TIGERIQ_WORKFORCE_INGRESS_TOKEN;
if(!token) throw new Error('INGRESS_TOKEN_REQUIRED');
if(!process.env.TIGERIQ_DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
const runtime=process.env.TIGERIQ_NV02_RUNTIME||'D:\\TigerIQ\\Runtime\\nv02-worker';
const assurance=path.join(runtime,'assure-job.mjs');
const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const runId=new Date().toISOString().replace(/[-:.]/g,'');
const tasks=[
  {name:'plan',prompt:'Return JSON only: {"task":"plan","steps":["audit","execute","verify"]}'},
  {name:'risk',prompt:'Return JSON only: {"task":"risk","risk":"low","control":"bounded-retry"}'},
  {name:'status',prompt:'Return JSON only: {"task":"status","state":"ready","next":"controller-work-order"}'},
];
async function state(jobId){
  const r=await fetch(new URL(`/api/v1/work-orders/${encodeURIComponent(jobId)}`,base),{headers:{authorization:`Bearer ${token}`}});
  const b=await r.json();if(!r.ok)throw new Error(`STATE_${r.status}`);return b.state;
}
async function controllerStatus(){const r=await fetch(new URL('/api/v1/status',base));return r.json();}
async function submit(def){
  const r=await fetch(new URL('/api/v1/work-orders',base),{method:'POST',headers,body:JSON.stringify(def)});
  const b=await r.json();if(!r.ok)throw new Error(`CREATE_${r.status}:${JSON.stringify(b)}`);return b.workOrder;
}
async function assure(jobId){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[assurance,jobId],{env:process.env,windowsHide:true});
    let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
    child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(out.trim().split(/\r?\n/).at(-1))):reject(new Error(`ASSURE_${code}:${err.slice(-1000)}:${out.slice(-1000)}`)));
  });
}
const results=[];
for(const task of tasks){
  const key=`nv02-517-${runId}-${task.name}`;
  const def={idempotencyKey:key,title:`NV02 517 ${task.name}`,objective:task.prompt,payload:{route:'groq',taskType:'ai',prompt:task.prompt},targetEmployeeId:'NV02',requiredPermissions:['cloud_ai:execute','evidence:write'],requiredCapabilities:['groq','evidence'],allowedWorkerKinds:['pc01'],expectedEvidence:['json'],scopeKeys:[`acceptance/517/${runId}/${task.name}`],dependencies:[],maxAttempts:2,independentReview:true,judgeRequired:true,priority:'P0'};
  const first=await submit(def);const duplicate=await submit(def);
  if(first.jobId!==duplicate.jobId)throw new Error(`IDEMPOTENCY_FAIL_${task.name}`);
  let s,maxQueued=0,maxLeases=0;
  for(let i=0;i<900;i++){
    const live=await controllerStatus();maxQueued=Math.max(maxQueued,Number(live.workforce?.queuedJobs||0));maxLeases=Math.max(maxLeases,Number(live.workforce?.activeLeases||0));
    s=await state(first.jobId);if(['reviewing','failed'].includes(s.job.stage))break;await sleep(100);
  }
  if(s?.job?.stage!=='reviewing')throw new Error(`EXECUTION_FAIL_${task.name}:${s?.job?.stage}`);
  const assured=await assure(first.jobId);
  s=await state(first.jobId);
  if(s.job.stage!=='done')throw new Error(`ASSURANCE_FAIL_${task.name}:${s.job.stage}`);
  if(s.result?.employeeId!=='NV02'||s.result?.output?.provider!=='groq')throw new Error(`EXECUTOR_IDENTITY_FAIL_${task.name}`);
  if((s.reviews||[]).length!==2)throw new Error(`REVIEW_COUNT_FAIL_${task.name}`);
  results.push({name:task.name,jobId:first.jobId,idempotent:true,maxQueued,maxLeases,executor:s.result.employeeId,provider:s.result.output.provider,model:s.result.output.model,reviews:s.reviews.map(r=>({role:r.role,reviewerId:r.reviewerId,verdict:r.verdict,independenceKey:r.independenceKey})),evidenceCount:(s.evidence||[]).length,finalStage:s.job.stage,assured});
}
const allPass=results.length===3&&results.every(r=>r.finalStage==='done'&&r.idempotent&&r.maxQueued>=1&&r.maxLeases>=1&&r.reviews.length===2);
const evidence={workOrder:'#517',runId,allPass,executor:'NV02/groq:openai/gpt-oss-120b',reviewer:'ollama:gemma3:4b',judge:'ollama:qwen3:8b',apiRetryMax:3,workOrderMaxAttempts:2,results,completedAt:new Date().toISOString()};
const dir='D:\\TigerIQ\\Evidence\\NV02-Groq';await mkdir(dir,{recursive:true});
const file=path.join(dir,`NV02-GROQ-517-ACCEPTANCE-${runId}.json`);await writeFile(file,JSON.stringify(evidence,null,2),'utf8');
console.log(JSON.stringify({...evidence,evidencePath:file}));
if(!allPass)process.exit(5);
