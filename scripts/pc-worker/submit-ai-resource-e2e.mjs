const base=process.env.TIGERIQ_WORKFORCE_CONTROLLER_URL;
const token=process.env.TIGERIQ_WORKFORCE_INGRESS_TOKEN;
if(!base||!token)throw new Error('CONTROLLER_ENV_MISSING');
const args=Object.fromEntries(process.argv.slice(2).map(item=>{const [k,...rest]=item.replace(/^--/,'').split('=');return[k,rest.join('=')||'true'];}));
const provider=args.provider||'gemini';
const risk=args.risk||'low';
const fallback=args.fallback==='true';
const preferred=fallback?['ollama','groq','gemini']:[provider,...['gemini','groq','ollama'].filter(x=>x!==provider)];
const run=new Date().toISOString().replace(/[-:.TZ]/g,'');
const prompt=risk==='high'?'Return one concise sentence confirming high-risk TigerIQ AI resource verification works.':'Return exactly one concise sentence confirming TigerIQ AI resource routing works.';
const body={idempotencyKey:`v2a529-${provider}-${risk}-${fallback?'failover':'direct'}-${run}`,title:`V2-A #529 ${provider} ${risk} E2E`,objective:prompt,payload:{route:'ai_auto',taskType:'ai',prompt,risk,kind:'analysis',providerPolicy:{zeroCostOnly:true,preferredProviders:preferred},acceptanceCriteria:['Concise successful confirmation.']},targetEmployeeId:'EMP-AI-RESOURCE',requiredPermissions:['evidence:write'],requiredCapabilities:['ai_resource'],allowedWorkerKinds:['pc01'],expectedEvidence:['json'],scopeKeys:[`v2-a/529/${provider}/${run}`],dependencies:[],maxAttempts:1,independentReview:false,judgeRequired:false,priority:'P0'};
const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
const created=await fetch(new URL('/api/v1/work-orders',base),{method:'POST',headers,body:JSON.stringify(body)});
const c=await created.json();if(!created.ok)throw new Error(`CREATE_${created.status}:${JSON.stringify(c)}`);
const jobId=c.workOrder.jobId;let state,maxLeases=0,maxQueued=0;
for(let i=0;i<900;i++){
  const live=await fetch(new URL('/api/v1/status',base));const ls=await live.json();
  maxLeases=Math.max(maxLeases,Number(ls.workforce?.activeLeases||0));maxQueued=Math.max(maxQueued,Number(ls.workforce?.queuedJobs||0));
  const response=await fetch(new URL(`/api/v1/work-orders/${encodeURIComponent(jobId)}`,base),{headers:{authorization:`Bearer ${token}`}});state=await response.json();
  if(['done','failed'].includes(state.state?.job?.stage))break;
  await new Promise(resolve=>setTimeout(resolve,200));
}
const s=state?.state;
console.log(JSON.stringify({jobId,stage:s?.job?.stage,employeeId:s?.result?.employeeId,deviceId:s?.result?.deviceId,bindingId:s?.result?.bindingId,route:s?.result?.output?.route,provider:s?.result?.output?.provider,model:s?.result?.output?.model,verificationMode:s?.result?.output?.verificationMode,attempts:s?.result?.output?.attempts,maxQueued,maxLeases,evidenceCount:(s?.evidence||[]).length,failure:s?.result?.failure}));
if(s?.job?.stage!=='done')process.exitCode=2;
