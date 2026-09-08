import { readFile } from 'node:fs/promises';
const base='http://100.97.23.87:8790';
const token=(await readFile('D:/TigerIQ/Secrets/pc01-primary-node.ingress-token','utf8')).trim();
const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const cases=[
 {type:'planning',prompt:'Create a concise 3-step plan to validate a generic AI worker. Return JSON with keys taskType, steps, status and status must be pass.'},
 {type:'code_analysis',prompt:'Analyze this rule: maxAttempts must be bounded at 3 and paid fallback forbidden. Return JSON with keys taskType, findings, status and status must be pass.'},
 {type:'test_generation',prompt:'Generate 3 concise test cases for TaskPacket idempotency and evidence. Return JSON with keys taskType, tests, status and status must be pass.'}
];
async function submit(c,key){
 const body={idempotencyKey:key,title:`NV02 acceptance ${c.type}`,objective:c.prompt,payload:{route:'groq',requireAssurance:true,requireJudge:true,taskType:c.type,prompt:c.prompt},targetEmployeeId:'NV02',requiredPermissions:['cloud_ai:execute','evidence:write'],requiredCapabilities:['groq','evidence'],allowedWorkerKinds:['pc01'],expectedEvidence:['json'],scopeKeys:[`runtime/nv02-517/${c.type}/${key}`],dependencies:[],maxAttempts:1,independentReview:false,judgeRequired:false,priority:'P0'};
 const r=await fetch(new URL('/api/v1/work-orders',base),{method:'POST',headers,body:JSON.stringify(body)});
 const j=await r.json(); return {status:r.status,body:j,request:body};
}
async function wait(jobId){
 let maxQueued=0,maxLeases=0,state;
 for(let i=0;i<1800;i++){
  const s=await (await fetch(new URL('/api/v1/status',base))).json();
  maxQueued=Math.max(maxQueued,Number(s.workforce?.queuedJobs||0));
  maxLeases=Math.max(maxLeases,Number(s.workforce?.activeLeases||0));
  const r=await fetch(new URL(`/api/v1/work-orders/${encodeURIComponent(jobId)}`,base),{headers:{authorization:`Bearer ${token}`}});
  state=await r.json(); const stage=state.state?.job?.stage;
  if(['done','failed'].includes(stage)) return {state,maxQueued,maxLeases};
  await sleep(250);
 }
 throw new Error(`TIMEOUT_${jobId}`);
}
const run=Date.now(); const results=[];
for(const c of cases){
 const key=`nv02-517-${c.type}-${run}`; const first=await submit(c,key);
 if(first.status<200||first.status>=300) throw new Error(`CREATE_${c.type}_${first.status}`);
 const jobId=first.body.workOrder.jobId; const final=await wait(jobId); const s=final.state.state;
 results.push({type:c.type,jobId,stage:s.job.stage,employee:s.result?.employeeId,provider:s.result?.output?.provider,reviewer:s.result?.output?.assurance?.reviewer?.identity,judge:s.result?.output?.assurance?.judge?.identity,evidence:(s.evidence||[]).length,maxQueued:final.maxQueued,maxLeases:final.maxLeases});
}
const dedupeKey=`nv02-517-dedupe-${run}`;
const d1=await submit(cases[0],dedupeKey); const d2=await submit(cases[0],dedupeKey);
if(![200,201,202].includes(d1.status)||![200,201,202].includes(d2.status)) throw new Error(`DEDUPE_HTTP_${d1.status}_${d2.status}`);
const d1id=d1.body.workOrder?.jobId,d2id=d2.body.workOrder?.jobId;
if(!d1id||d1id!==d2id) throw new Error(`DEDUPE_JOB_MISMATCH_${d1id}_${d2id}`);
const dedupeFinal=await wait(d1id);
const retrySrc=await readFile('D:/TigerIQ/Runtime/nv02-worker/invoke-groq-prompt.ps1','utf8');
const retryPolicy={
 maxAttempts3:retrySrc.includes('[ValidateRange(1,3)][int]$MaxAttempts=3'),
 rateLimit429:retrySrc.includes("$status -eq 429"),
 boundedClasses:retrySrc.includes("@('rate_limit','outage','timeout')"),
 exponentialBackoff:retrySrc.includes('[Math]::Pow(2,$attempt-1)'),
 paidFallbackFalse:retrySrc.includes('[bool]$proof.paidFallbackAllowed')
};
if(Object.values(retryPolicy).some(v=>!v)) throw new Error(`RETRY_POLICY_FAIL_${JSON.stringify(retryPolicy)}`);
for(const r of results){
 if(r.stage!=='done'||r.employee!=='NV02'||r.provider!=='groq'||r.reviewer!=='ollama:gemma3:4b'||r.judge!=='ollama:qwen3:8b'||r.evidence<1||r.maxLeases<1) throw new Error(`ACCEPTANCE_FAIL_${JSON.stringify(r)}`);
}
console.log(JSON.stringify({status:'PASS',run,results,dedupe:{jobId:d1id,sameJob:true,stage:dedupeFinal.state.state.job.stage},retryPolicy},null,2));
